package app.keylab.catalog.adapter.out.persistence;

import java.math.BigDecimal;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import app.keylab.catalog.domain.PartSounds;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@link PartSounds} in the catalog tables: {@code sound_fx} of mods and case
 * parts, keycap sets' {@code sound_shift}, and {@code switch_recordings}.
 * Pulled switches, hidden sets, switched-off mods and retired case parts all
 * resolve, so an old shared build still plays; drafts do not.
 */
@Repository
class JdbcPartSounds implements PartSounds {

    private final JdbcClient jdbc;
    private final JsonMapper json;

    JdbcPartSounds(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    public Optional<SwitchSound> switchSound(String slug) {
        record Found(UUID id, String profile) {
        }
        return jdbc
            .sql("SELECT id, profile FROM catalog.switches WHERE slug = ? AND status IN ('published', 'hidden')")
            .param(slug)
            .query((rs, n) -> new Found(rs.getObject("id", UUID.class), rs.getString("profile")))
            .optional()
            .map((sw) -> new SwitchSound(sw.id(), sw.profile(), takes(sw.id())));
    }

    private List<Take> takes(UUID switchId) {
        return jdbc.sql("""
                SELECT recording_id, variant, stroke, url, duration_ms, loudness_lufs, peaks
                FROM catalog.switch_recordings WHERE switch_id = ?
                """)
            .param(switchId)
            .query(this::take)
            .list();
    }

    @Override
    public Map<String, ModSound> mods(Collection<String> slugs) {
        Map<String, ModSound> found = new HashMap<>();
        if (slugs.isEmpty()) {
            return found;
        }
        jdbc.sql("SELECT slug, levels, sound_fx FROM catalog.mods WHERE slug IN (:slugs)")
            .param("slugs", slugs)
            .query(this::mod)
            .list()
            .forEach((mod) -> found.put(mod.slug(), mod));
        return found;
    }

    @Override
    public Optional<BigDecimal> keycapShift(String slug) {
        return jdbc
            .sql("SELECT sound_shift FROM catalog.keycap_sets WHERE slug = ? AND status IN ('published', 'hidden')")
            .param(slug)
            .query(BigDecimal.class)
            .optional();
    }

    @Override
    public Optional<CaseSound> caseMaterial(String id) {
        return caseSound("case_materials", id);
    }

    @Override
    public Optional<CaseSound> plate(String id) {
        return caseSound("plates", id);
    }

    @Override
    public Optional<CaseSound> mount(String id) {
        return caseSound("mounts", id);
    }

    /** {@code table} is one of three constants, never input. */
    private Optional<CaseSound> caseSound(String table, String id) {
        return jdbc.sql("SELECT sound_fx FROM catalog." + table + " WHERE id = ?")
            .param(id)
            .query(String.class)
            .optional()
            .map((fx) -> {
                JsonNode node = json.readTree(fx);
                return new CaseSound(number(node, "pitch", 1), number(node, "bright", 0), number(node, "decay", 1),
                        number(node, "thump", 1));
            });
    }

    /** A factor the row does not hold is neutral. */
    private static double number(JsonNode node, String name, double neutral) {
        JsonNode value = node.get(name);
        return value == null || !value.isNumber() ? neutral : value.asDouble();
    }

    private ModSound mod(ResultSet rs, int rowNum) throws SQLException {
        Array levels = rs.getArray("levels");
        JsonNode fx = json.readTree(rs.getString("sound_fx"));
        return new ModSound(rs.getString("slug"), levels == null ? null : List.of((String[]) levels.getArray()),
                new Steps((int) number(fx, "pitch", 0), (int) number(fx, "thock", 0), (int) number(fx, "volume", 0),
                        (int) number(fx, "rattle", 0)));
    }

    private Take take(ResultSet rs, int rowNum) throws SQLException {
        String peaks = rs.getString("peaks");
        BigDecimal loudness = rs.getBigDecimal("loudness_lufs");
        return new Take(rs.getObject("recording_id", UUID.class), rs.getString("variant"), rs.getString("stroke"),
                rs.getString("url"), (Integer) rs.getObject("duration_ms"), loudness == null ? null : plain(loudness),
                peaks == null ? null : List.of(json.readValue(peaks, Double[].class)));
    }

    /** NUMERIC reads back with its scale; the API sends -14.2, as CAT-03 does. */
    private static BigDecimal plain(BigDecimal value) {
        BigDecimal stripped = value.stripTrailingZeros();
        return stripped.scale() < 0 ? stripped.setScale(0) : stripped;
    }
}
