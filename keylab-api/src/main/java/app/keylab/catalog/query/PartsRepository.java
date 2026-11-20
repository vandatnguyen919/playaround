package app.keylab.catalog.query;

import java.math.BigDecimal;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import app.keylab.catalog.query.CaseOptionsView.Part;
import app.keylab.catalog.query.ModRow.Effects;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import tools.jackson.databind.json.JsonMapper;

/**
 * Reads of the parts catalog besides switches (CAT-05 to CAT-08), SQL straight
 * to read models. Only what builders may pick leaves here: published keycap
 * sets, live mods and active case parts, in screen order ({@code position}).
 */
@Repository
public class PartsRepository {

    private final JdbcClient jdbc;
    private final JsonMapper json;

    PartsRepository(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** One page (plus one row) of published keycap sets after {@code after}, or from the start. */
    public List<KeycapSetRow> publishedKeycapSets(After after, int limit) {
        return page("SELECT * FROM catalog.keycap_sets WHERE status = 'published'", after, limit)
            .query(this::keycapSet)
            .list();
    }

    public Optional<KeycapSetRow> publishedKeycapSet(String slug) {
        return jdbc.sql("SELECT * FROM catalog.keycap_sets WHERE slug = ? AND status = 'published'")
            .param(slug)
            .query(this::keycapSet)
            .optional();
    }

    /** One page (plus one row) of live mods after {@code after}, or from the start. */
    public List<ModRow> liveMods(After after, int limit) {
        return page("SELECT * FROM catalog.mods WHERE live", after, limit).query(this::mod).list();
    }

    public CaseOptionsView caseOptions() {
        List<Part> materials = jdbc
            .sql("SELECT id, name, note, colors FROM catalog.case_materials WHERE is_active ORDER BY position, id")
            .query((rs, n) -> new Part(rs.getString("id"), rs.getString("name"), rs.getString("note"),
                    texts(rs.getArray("colors"))))
            .list();
        return new CaseOptionsView(materials, parts("plates"), parts("mounts"));
    }

    /** Where the previous page of a list in {@code (position, id)} order stopped. */
    public record After(int position, UUID id) {
    }

    private JdbcClient.StatementSpec page(String select, After after, int limit) {
        if (after == null) {
            return jdbc.sql(select + " ORDER BY position, id LIMIT :limit").param("limit", limit);
        }
        return jdbc.sql(select + " AND (position, id) > (:afterPosition, :afterId) ORDER BY position, id LIMIT :limit")
            .param("afterPosition", after.position())
            .param("afterId", after.id())
            .param("limit", limit);
    }

    /** {@code table} is one of two constants, never input. */
    private List<Part> parts(String table) {
        return jdbc.sql("SELECT id, name, note FROM catalog." + table + " WHERE is_active ORDER BY position, id")
            .query((rs, n) -> new Part(rs.getString("id"), rs.getString("name"), rs.getString("note"), null))
            .list();
    }

    private KeycapSetRow keycapSet(ResultSet rs, int rowNum) throws SQLException {
        return new KeycapSetRow(rs.getObject("id", UUID.class), rs.getString("slug"), rs.getString("name"),
                rs.getString("material"), rs.getString("profile"), rs.getString("base_hex"),
                rs.getString("alpha_hex"), rs.getString("mod_hex"), rs.getString("accent_hex"),
                plain(rs.getBigDecimal("sound_shift")), rs.getInt("key_count"), rs.getInt("position"));
    }

    private ModRow mod(ResultSet rs, int rowNum) throws SQLException {
        Array levels = rs.getArray("levels");
        return new ModRow(rs.getObject("id", UUID.class), rs.getString("slug"), rs.getString("name"),
                rs.getString("description"), rs.getString("impact"), levels == null ? null : texts(levels),
                json.readValue(rs.getString("sound_fx"), Effects.class), rs.getBoolean("live"),
                rs.getInt("position"));
    }

    private static List<String> texts(Array array) throws SQLException {
        return List.of((String[]) array.getArray());
    }

    /** NUMERIC reads back with its scale (-0.50, 0.00); the API sends -0.5 and 0. */
    private static BigDecimal plain(BigDecimal value) {
        BigDecimal stripped = value.stripTrailingZeros();
        return stripped.scale() < 0 ? stripped.setScale(0) : stripped;
    }
}
