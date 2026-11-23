package app.keylab.builds.adapter.out.persistence;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import app.keylab.builds.domain.Build;
import app.keylab.builds.domain.BuildChangedMeanwhile;
import app.keylab.builds.domain.BuildEvent;
import app.keylab.builds.domain.BuildVersion;
import app.keylab.builds.domain.Builds;
import app.keylab.builds.domain.KeycapLook;
import app.keylab.builds.domain.Parts;
import app.keylab.builds.domain.Parts.ModChoice;
import app.keylab.builds.domain.Sound;
import app.keylab.builds.domain.Visibility;
import app.keylab.shared.Ids;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@link Builds} in {@code builds.builds}, {@code build_versions} and
 * {@code build_version_mods}, by plain SQL. A save names the row version the
 * build was loaded at, so one that lost a race touches no row and its new
 * version is rolled back with the transaction.
 */
@Repository
class JdbcBuilds implements Builds {

    private final JdbcClient jdbc;
    private final JsonMapper json;

    JdbcBuilds(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    public Optional<Build> load(UUID id) {
        return jdbc.sql("""
                SELECT b.id, b.owner_id, b.name, b.visibility, b.version, b.created_at, b.updated_at,
                  v.id AS version_id, v.version_no, v.layout, v.switch_slug, v.switch_variant, v.keycap_set,
                  v.keycap_profile, v.keycap_material, v.case_material, v.case_color_hex, v.plate, v.mount,
                  v.desk_pad, v.config
                FROM builds.builds b JOIN builds.build_versions v ON v.id = b.current_version_id
                WHERE b.id = ? AND b.deleted_at IS NULL
                """)
            .param(id)
            .query(this::row)
            .optional();
    }

    @Override
    public void add(Build build) {
        jdbc.sql("""
                INSERT INTO builds.builds (id, owner_id, name, visibility, version, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """)
            .params(build.id(), build.ownerId(), build.name(), build.visibility().wire(), build.version(),
                    Timestamp.from(build.createdAt()), Timestamp.from(build.updatedAt()))
            .update();
        UUID versionId = insertVersion(build.id(), build.current(), build.createdAt());
        jdbc.sql("UPDATE builds.builds SET current_version_id = ? WHERE id = ?").params(versionId, build.id()).update();
    }

    @Override
    public void save(Build build) {
        UUID newVersion = null;
        for (BuildEvent event : build.events()) {
            if (event instanceof BuildEvent.Saved saved) {
                try {
                    newVersion = insertVersion(build.id(), saved.version(), build.updatedAt());
                }
                catch (DuplicateKeyException ex) {
                    // Another save took this version number first.
                    throw new BuildChangedMeanwhile();
                }
            }
        }
        int updated = jdbc.sql("""
                UPDATE builds.builds SET name = :name, visibility = :visibility, updated_at = :now,
                  current_version_id = COALESCE(:versionId, current_version_id), version = version + 1,
                  deleted_at = :deletedAt
                WHERE id = :id AND version = :version AND deleted_at IS NULL
                """)
            .param("name", build.name())
            .param("visibility", build.visibility().wire())
            .param("now", Timestamp.from(build.updatedAt()))
            .param("versionId", newVersion)
            .param("deletedAt", build.deletedAt() == null ? null : Timestamp.from(build.deletedAt()))
            .param("id", build.id())
            .param("version", build.version())
            .update();
        if (updated != 1) {
            throw new BuildChangedMeanwhile();
        }
    }

    private UUID insertVersion(UUID buildId, BuildVersion version, Instant now) {
        UUID versionId = Ids.uuidV7();
        Parts parts = version.parts();
        KeycapLook keycaps = version.keycaps();
        jdbc.sql("""
                INSERT INTO builds.build_versions (id, build_id, version_no, layout, switch_slug, switch_variant,
                  keycap_set, keycap_profile, keycap_material, case_material, case_color_hex, plate, mount,
                  desk_pad, config, created_at)
                VALUES (:id, :buildId, :number, :layout, :switchSlug, :variant, :keycapSet, :keycapProfile,
                  :keycapMaterial, :caseMaterial, :caseColor, :plate, :mount, :deskPad, CAST(:config AS jsonb), :now)
                """)
            .param("id", versionId)
            .param("buildId", buildId)
            .param("number", version.number())
            .param("layout", parts.layout())
            .param("switchSlug", parts.switchSlug())
            .param("variant", parts.variant())
            .param("keycapSet", parts.keycapSet())
            .param("keycapProfile", keycaps == null ? null : keycaps.profile())
            .param("keycapMaterial", keycaps == null ? null : keycaps.material())
            .param("caseMaterial", parts.caseMaterial())
            .param("caseColor", parts.caseColor())
            .param("plate", parts.plate())
            .param("mount", parts.mount())
            .param("deskPad", parts.deskPad())
            .param("config", json.writeValueAsString(config(version.sound())))
            .param("now", Timestamp.from(now))
            .update();
        for (int i = 0; i < parts.mods().size(); i++) {
            ModChoice mod = parts.mods().get(i);
            jdbc.sql("INSERT INTO builds.build_version_mods (version_id, mod_slug, level, position) VALUES (?, ?, ?, ?)")
                .params(versionId, mod.slug(), mod.level(), i)
                .update();
        }
        return versionId;
    }

    /** The version's {@code config}: today only the recipe's sound (database-design.md). */
    static Map<String, Object> config(Sound sound) {
        Map<String, Object> meter = new LinkedHashMap<>();
        meter.put("position", sound.meterPosition());
        meter.put("word", sound.meterWord());
        Map<String, Object> soundJson = new LinkedHashMap<>();
        soundJson.put("lowShelfDb", sound.lowShelfDb());
        soundJson.put("highShelfDb", sound.highShelfDb());
        soundJson.put("reverbMix", sound.reverbMix());
        soundJson.put("gainDb", sound.gainDb());
        soundJson.put("meter", meter);
        return Map.of("sound", soundJson);
    }

    private Build row(ResultSet rs, int rowNum) throws SQLException {
        UUID versionId = rs.getObject("version_id", UUID.class);
        List<ModChoice> mods = jdbc
            .sql("SELECT mod_slug, level FROM builds.build_version_mods WHERE version_id = ? ORDER BY position")
            .param(versionId)
            .query((m, n) -> new ModChoice(m.getString("mod_slug"), m.getString("level")))
            .list();
        Parts parts = new Parts(rs.getString("layout"), rs.getString("switch_slug"), rs.getString("switch_variant"),
                mods, rs.getString("keycap_set"), rs.getString("case_material"), rs.getString("case_color_hex"),
                rs.getString("plate"), rs.getString("mount"), rs.getString("desk_pad"));
        String profile = rs.getString("keycap_profile");
        KeycapLook keycaps = profile == null && rs.getString("keycap_material") == null ? null
                : new KeycapLook(profile, rs.getString("keycap_material"));
        JsonNode sound = json.readTree(rs.getString("config")).path("sound");
        Sound recipe = new Sound(sound.path("lowShelfDb").asDouble(), sound.path("highShelfDb").asDouble(),
                sound.path("reverbMix").asDouble(), sound.path("gainDb").asDouble(),
                sound.path("meter").path("position").asDouble(), sound.path("meter").path("word").asString());
        return Build.restore(rs.getObject("id", UUID.class), rs.getObject("owner_id", UUID.class),
                rs.getString("name"), Visibility.from(rs.getString("visibility")).orElseThrow(),
                new BuildVersion(rs.getInt("version_no"), parts, keycaps, recipe), rs.getLong("version"),
                rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
    }
}
