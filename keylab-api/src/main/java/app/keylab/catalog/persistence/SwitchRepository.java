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

    /** @return false when the row is gone, no longer a draft, or no longer at {@code expectedVersion} */
    public boolean deleteDraft(UUID id, long expectedVersion) {
        return jdbc.sql("DELETE FROM catalog.switches WHERE id = ? AND version = ? AND status = 'draft'")
            .params(id, expectedVersion)
            .update() == 1;
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

    private Switch row(ResultSet rs, int rowNum) throws SQLException {
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
                rs.getLong("version"), instant(rs.getTimestamp("updated_at")));
    }

    /** NUMERIC(5,1) reads back as 62.0; the API sends 62. */
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
