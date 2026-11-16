package app.keylab.catalog.persistence;

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
import app.keylab.catalog.domain.Switch;
import app.keylab.catalog.domain.SwitchSpecs;
import app.keylab.catalog.domain.SwitchSpecs.SoundProfile;
import app.keylab.catalog.domain.SwitchSpecs.SwitchType;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * Switches in {@code catalog.switches}, by plain SQL. Updates and deletes
 * name the version they expect, so a change that lost a race with another
 * editor touches no row and the caller answers 412.
 */
@Repository
public class SwitchRepository {

    private static final TypeReference<List<ForceCurvePoint>> CURVE = new TypeReference<>() {
    };

    private final JdbcClient jdbc;
    private final JsonMapper json;

    SwitchRepository(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public Optional<Switch> find(UUID id) {
        return jdbc.sql("SELECT * FROM catalog.switches WHERE id = ?").param(id).query(this::row).optional();
    }

    /**
     * ADM-02 list (drafts too), by name then id, from the cursor on.
     *
     * @param q part of the name or brand, or null
     */
    public List<Switch> listByName(String q, String afterName, UUID afterId, int limit) {
        StringBuilder sql = new StringBuilder("SELECT * FROM catalog.switches WHERE true");
        List<Object> params = new java.util.ArrayList<>();
        if (q != null) {
            String like = "%" + q.toLowerCase(java.util.Locale.ROOT).replace("!", "!!").replace("%", "!%")
                .replace("_", "!_") + "%";
            sql.append(" AND (lower(name) LIKE ? ESCAPE '!' OR lower(coalesce(brand, '')) LIKE ? ESCAPE '!')");
            params.add(like);
            params.add(like);
        }
        if (afterName != null) {
            sql.append(" AND (lower(name), id) > (?, ?)");
            params.add(afterName);
            params.add(afterId);
        }
        sql.append(" ORDER BY lower(name), id LIMIT ?");
        params.add(limit);
        return jdbc.sql(sql.toString()).params(params).query(this::row).list();
    }

    public List<String> slugsStartingWith(String base) {
        return jdbc.sql("SELECT slug FROM catalog.switches WHERE slug = ? OR slug LIKE ?")
            .params(base, base.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "-%")
            .query(String.class).list();
    }

    public void insert(UUID id, String slug, SwitchSpecs specs, String userId, Instant now) {
        jdbc.sql("""
                INSERT INTO catalog.switches (id, slug, name, brand, type, profile, stem_color, force_g, actuation_mm,
                  travel_mm, bottom_out_g, spring, housing, force_curve, created_by, updated_by, created_at, updated_at)
                VALUES (:id, :slug, :name, :brand, :type, :profile, :stemColor, :forceG, :actuationMm,
                  :travelMm, :bottomOutG, :spring, :housing, CAST(:forceCurve AS jsonb), :userId, :userId, :now, :now)
                """)
            .params(params(specs, id, slug, userId, now))
            .update();
    }

    /** @return false when the row is gone or no longer at {@code expectedVersion} */
    public boolean update(UUID id, long expectedVersion, String slug, SwitchSpecs specs, String userId, Instant now) {
        return jdbc.sql("""
                UPDATE catalog.switches SET slug = :slug, name = :name, brand = :brand, type = :type,
                  profile = :profile, stem_color = :stemColor, force_g = :forceG, actuation_mm = :actuationMm,
                  travel_mm = :travelMm, bottom_out_g = :bottomOutG, spring = :spring, housing = :housing,
                  force_curve = CAST(:forceCurve AS jsonb), updated_by = :userId, updated_at = :now,
                  version = version + 1
                WHERE id = :id AND version = :version
                """)
            .params(params(specs, id, slug, userId, now))
            .param("version", expectedVersion)
            .update() == 1;
    }

    /**
     * Sets or clears the photo (US-38). It rides on the save that names it,
     * so it does not move the version again.
     */
    public void setPhoto(UUID id, String photoUrl) {
        jdbc.sql("UPDATE catalog.switches SET photo_url = ? WHERE id = ?").params(photoUrl, id).update();
    }

    /** @return false when the row is gone, no longer a draft, or no longer at {@code expectedVersion} */
    public boolean deleteDraft(UUID id, long expectedVersion) {
        return jdbc.sql("DELETE FROM catalog.switches WHERE id = ? AND version = ? AND status = 'draft'")
            .params(id, expectedVersion)
            .update() == 1;
    }

    /**
     * Puts the switch in the public library (ADM-03, US-39). The SQL repeats
     * the sound check, so a switch whose sounds were just pulled cannot slip
     * through. The first publish date stays when a pulled switch comes back.
     *
     * @param newUntil until when the New sticker shows, or null for none
     * @return false when the row is gone or its stock sounds are not ready
     */
    public boolean publish(UUID id, Instant newUntil, String userId, Instant now) {
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
    public void unpublish(UUID id, String userId, Instant now) {
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

    private Map<String, Object> params(SwitchSpecs specs, UUID id, String slug, String userId, Instant now) {
        Map<String, Object> params = new HashMap<>();
        params.put("id", id);
        params.put("slug", slug);
        params.put("userId", userId);
        params.put("now", Timestamp.from(now));
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
        return params;
    }

    /** Maps a {@code catalog.switches} row; LibraryRepository reads the same rows. */
    Switch row(ResultSet rs, int rowNum) throws SQLException {
        String profile = rs.getString("profile");
        SwitchSpecs specs = new SwitchSpecs(rs.getString("name"), rs.getString("brand"),
                SwitchType.valueOf(rs.getString("type")), profile == null ? null : SoundProfile.valueOf(profile),
                rs.getString("stem_color"), plain(rs.getBigDecimal("force_g")),
                plain(rs.getBigDecimal("actuation_mm")), plain(rs.getBigDecimal("travel_mm")),
                plain(rs.getBigDecimal("bottom_out_g")), rs.getString("spring"), rs.getString("housing"),
                List.copyOf(json.readValue(rs.getString("force_curve"), CURVE)));
        return new Switch(rs.getObject("id", UUID.class), rs.getString("slug"), specs,
                Switch.Status.valueOf(rs.getString("status")), rs.getString("sound_status"),
                instant(rs.getTimestamp("new_until")), instant(rs.getTimestamp("published_at")),
                rs.getLong("version"), instant(rs.getTimestamp("updated_at")), rs.getString("photo_url"));
    }

    /** NUMERIC(5,1) reads back as 62.0; the API sends 62. */
    static BigDecimal plain(BigDecimal value) {
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
