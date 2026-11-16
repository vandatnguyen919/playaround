package app.keylab.catalog.adapter.out.persistence;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import app.keylab.catalog.domain.ForceCurvePoint;
import app.keylab.catalog.domain.MissingRequiredSounds;
import app.keylab.catalog.domain.SlugTaken;
import app.keylab.catalog.domain.SoundStatus;
import app.keylab.catalog.domain.Status;
import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.domain.SwitchChangedMeanwhile;
import app.keylab.catalog.domain.SwitchEvent;
import app.keylab.catalog.domain.SwitchSpecs;
import app.keylab.catalog.domain.SwitchSpecs.SoundProfile;
import app.keylab.catalog.domain.SwitchSpecs.SwitchType;
import app.keylab.catalog.domain.Switches;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@link Switches} in {@code catalog.switches}, by plain SQL. A save writes
 * what the aggregate recorded: an edit names the version it was loaded at,
 * so one that lost a race touches no row; publishing re-checks the sound
 * status, so a switch whose sounds were just pulled cannot slip through. The
 * recorded events are published after the write.
 */
@Repository
class JdbcSwitches implements Switches {

    private static final TypeReference<List<ForceCurvePoint>> CURVE = new TypeReference<>() {
    };

    private final JdbcClient jdbc;
    private final JsonMapper json;
    private final ApplicationEventPublisher events;

    JdbcSwitches(JdbcClient jdbc, JsonMapper json, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.json = json;
        this.events = events;
    }

    @Override
    public Optional<Switch> load(UUID id) {
        return jdbc.sql("SELECT * FROM catalog.switches WHERE id = ?").param(id).query(this::row).optional();
    }

    @Override
    public boolean existsBySlug(String slug) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM catalog.switches WHERE slug = ?)").param(slug)
            .query(Boolean.class).single();
    }

    @Override
    public void add(Switch sw) {
        try {
            jdbc.sql("""
                    INSERT INTO catalog.switches (id, slug, name, brand, type, profile, stem_color, force_g,
                      actuation_mm, travel_mm, bottom_out_g, spring, housing, force_curve, photo_url, created_by,
                      updated_by, created_at, updated_at)
                    VALUES (:id, :slug, :name, :brand, :type, :profile, :stemColor, :forceG, :actuationMm,
                      :travelMm, :bottomOutG, :spring, :housing, CAST(:forceCurve AS jsonb), :photoUrl, :userId,
                      :userId, :now, :now)
                    """)
                .params(params(sw))
                .update();
        }
        catch (DuplicateKeyException ex) {
            throw new SlugTaken(ex);
        }
        publish(sw);
    }

    @Override
    public void save(Switch sw) {
        for (SwitchEvent event : sw.events()) {
            switch (event) {
                case SwitchEvent.Edited edited -> update(sw);
                case SwitchEvent.Published published -> {
                    if (!publish(sw.id(), published.newUntil(), sw.updatedBy(), sw.updatedAt())) {
                        throw new MissingRequiredSounds();
                    }
                }
                case SwitchEvent.Unpublished unpublished -> unpublish(sw.id(), sw.updatedBy(), sw.updatedAt());
            }
        }
        publish(sw);
    }

    @Override
    public void remove(Switch sw) {
        int deleted = jdbc.sql("DELETE FROM catalog.switches WHERE id = ? AND version = ? AND status = 'draft'")
            .params(sw.id(), sw.version())
            .update();
        if (deleted != 1) {
            throw new SwitchChangedMeanwhile();
        }
    }

    /** The specs, slug and photo, only at the version the switch was loaded at. */
    private void update(Switch sw) {
        int updated;
        try {
            updated = jdbc.sql("""
                    UPDATE catalog.switches SET slug = :slug, name = :name, brand = :brand, type = :type,
                      profile = :profile, stem_color = :stemColor, force_g = :forceG, actuation_mm = :actuationMm,
                      travel_mm = :travelMm, bottom_out_g = :bottomOutG, spring = :spring, housing = :housing,
                      force_curve = CAST(:forceCurve AS jsonb), photo_url = :photoUrl, updated_by = :userId,
                      updated_at = :now, version = version + 1
                    WHERE id = :id AND version = :version
                    """)
                .params(params(sw))
                .param("version", sw.version())
                .update();
        }
        catch (DuplicateKeyException ex) {
            // Lost a race for the slug; the editor saves again and gets the next free one.
            throw new SlugTaken(ex);
        }
        if (updated != 1) {
            throw new SwitchChangedMeanwhile();
        }
    }

    /**
     * Puts the switch in the public library (ADM-03, US-39). The first
     * publish date stays when a pulled switch comes back.
     *
     * @return false when the row is gone or its stock sounds are not ready
     */
    private boolean publish(UUID id, Instant newUntil, String userId, Instant now) {
        return jdbc.sql("""
                UPDATE catalog.switches SET status = 'published', published_at = COALESCE(published_at, :now),
                  new_until = :newUntil, updated_by = :userId, updated_at = :now, version = version + 1
                WHERE id = :id AND sound_status = 'recorded'
                """)
            .param("id", id)
            .param("newUntil", newUntil == null ? null : Timestamp.from(newUntil))
            .param("userId", userId)
            .param("now", Timestamp.from(now))
            .update() == 1;
    }

    /** Pulls a published switch from the library; it stays for builds that use it ("hidden"). */
    private void unpublish(UUID id, String userId, Instant now) {
        jdbc.sql("""
                UPDATE catalog.switches SET status = 'hidden', new_until = NULL, updated_by = :userId,
                  updated_at = :now, version = version + 1
                WHERE id = :id AND status = 'published'
                """)
            .param("id", id)
            .param("userId", userId)
            .param("now", Timestamp.from(now))
            .update();
    }

    private void publish(Switch sw) {
        sw.events().forEach(events::publishEvent);
        sw.clearEvents();
    }

    private Map<String, Object> params(Switch sw) {
        SwitchSpecs specs = sw.specs();
        Map<String, Object> params = new HashMap<>();
        params.put("id", sw.id());
        params.put("slug", sw.slug());
        params.put("userId", sw.updatedBy());
        params.put("now", Timestamp.from(sw.updatedAt()));
        params.put("name", specs.name());
        params.put("brand", specs.brand());
        params.put("type", specs.type().name());
        params.put("profile", specs.profile() == null ? null : specs.profile().name());
        params.put("stemColor", specs.stemColor());
        params.put("forceG", specs.forceG());
        params.put("actuationMm", specs.actuationMm());
        params.put("travelMm", specs.travelMm());
        params.put("bottomOutG", specs.bottomOutG());
        params.put("spring", specs.spring());
        params.put("housing", specs.housing());
        params.put("forceCurve", json.writeValueAsString(specs.forceCurve()));
        params.put("photoUrl", sw.photoUrl());
        return params;
    }

    private Switch row(ResultSet rs, int rowNum) throws SQLException {
        String profile = rs.getString("profile");
        SwitchSpecs specs = new SwitchSpecs(rs.getString("name"), rs.getString("brand"),
                SwitchType.valueOf(rs.getString("type")), profile == null ? null : SoundProfile.valueOf(profile),
                rs.getString("stem_color"), plain(rs.getBigDecimal("force_g")),
                plain(rs.getBigDecimal("actuation_mm")), plain(rs.getBigDecimal("travel_mm")),
                plain(rs.getBigDecimal("bottom_out_g")), rs.getString("spring"), rs.getString("housing"),
                List.copyOf(json.readValue(rs.getString("force_curve"), CURVE)));
        return Switch.restore(rs.getObject("id", UUID.class), rs.getString("slug"), specs,
                Status.fromWire(rs.getString("status")), SoundStatus.fromWire(rs.getString("sound_status")),
                instant(rs.getTimestamp("new_until")), instant(rs.getTimestamp("published_at")),
                rs.getLong("version"), instant(rs.getTimestamp("updated_at")), rs.getString("updated_by"),
                rs.getString("photo_url"));
    }

    /** NUMERIC(5,1) reads back as 62.0; the specs hold 62. */
    private static BigDecimal plain(BigDecimal value) {
        if (value == null) {
            return null;
        }
        BigDecimal stripped = value.stripTrailingZeros();
        return stripped.scale() < 0 ? stripped.setScale(0) : stripped;
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
