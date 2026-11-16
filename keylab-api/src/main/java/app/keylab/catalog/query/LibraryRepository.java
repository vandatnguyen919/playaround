package app.keylab.catalog.query;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import app.keylab.catalog.query.LibraryFilter.Sort;
import app.keylab.catalog.query.SwitchRow.CurvePoint;
import app.keylab.shared.paging.Cursor;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * The catalog's reads, SQL straight to read models (CAT-01 to CAT-04, and the
 * ADM-02 list and editor). Only {@code status = 'published'} rows ever leave
 * here for the public side: drafts and pulled switches stay with the editors.
 */
@Repository
public class LibraryRepository {

    /** Sorts switches with no force after every real one. */
    static final BigDecimal NO_FORCE = new BigDecimal("1000");
    private static final TypeReference<List<CurvePoint>> CURVE = new TypeReference<>() {
    };
    private static final TypeReference<List<Double>> PEAKS = new TypeReference<>() {
    };

    private final JdbcClient jdbc;
    private final JsonMapper json;

    LibraryRepository(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /**
     * One page of published switches, plus one more row to tell whether a next
     * page exists. {@code after} is the last row of the previous page in the
     * same sort.
     */
    public List<SwitchRow> published(LibraryFilter filter, Cursor after, int limit, Instant now) {
        StringBuilder sql = new StringBuilder("SELECT * FROM catalog.switches WHERE status = 'published'");
        Map<String, Object> params = new HashMap<>();
        params.put("now", Timestamp.from(now));
        if (filter.type() != null) {
            sql.append(" AND type = :type");
            params.put("type", filter.type());
        }
        if (filter.profile() != null) {
            sql.append(" AND profile = :profile");
            params.put("profile", filter.profile());
        }
        if ("recorded".equals(filter.sound())) {
            sql.append(" AND sound_status = 'recorded'");
        }
        else if ("missing".equals(filter.sound())) {
            sql.append(" AND sound_status <> 'recorded'");
        }
        if (filter.q() != null) {
            sql.append(" AND (name ILIKE :q ESCAPE '!' OR brand ILIKE :q ESCAPE '!')");
            params.put("q", "%" + likeEscape(filter.q().toLowerCase(Locale.ROOT)) + "%");
        }
        if (Boolean.TRUE.equals(filter.isNew())) {
            sql.append(" AND new_until > :now");
        }
        else if (Boolean.FALSE.equals(filter.isNew())) {
            sql.append(" AND (new_until IS NULL OR new_until <= :now)");
        }
        if (filter.forceMin() != null) {
            sql.append(" AND force_g >= :forceMin");
            params.put("forceMin", filter.forceMin());
        }
        if (filter.forceMax() != null) {
            sql.append(" AND force_g <= :forceMax");
            params.put("forceMax", filter.forceMax());
        }
        if (filter.sort() == Sort.force) {
            params.put("noForce", NO_FORCE);
            if (after != null) {
                sql.append(" AND (COALESCE(force_g, :noForce), id) > (:afterForce, :afterId)");
                params.put("afterForce", new BigDecimal(after.value(1)));
                params.put("afterId", UUID.fromString(after.value(2)));
            }
            sql.append(" ORDER BY COALESCE(force_g, :noForce) ASC, id ASC");
        }
        else {
            // "popular" has no play counts to rank by yet, so it lists the newest first.
            if (after != null) {
                sql.append(" AND (published_at, id) < (:afterPublished, :afterId)");
                params.put("afterPublished", Timestamp.from(Instant.parse(after.value(1))));
                params.put("afterId", UUID.fromString(after.value(2)));
            }
            sql.append(" ORDER BY published_at DESC, id DESC");
        }
        sql.append(" LIMIT :limit");
        params.put("limit", limit);
        return jdbc.sql(sql.toString()).params(params).query(this::row).list();
    }

    public Optional<SwitchRow> publishedBySlug(String slug) {
        return jdbc.sql("SELECT * FROM catalog.switches WHERE slug = ? AND status = 'published'")
            .param(slug).query(this::row).optional();
    }

    /**
     * Published switches that sound most like {@code sw} (CAT-04): the same
     * sound profile first, then the same type, then recorded before missing,
     * then the nearest actuation force. Never {@code sw} itself.
     */
    public List<SwitchRow> related(SwitchRow sw, int limit) {
        BigDecimal force = sw.forceG() == null ? NO_FORCE : sw.forceG();
        return jdbc.sql("""
                SELECT * FROM catalog.switches WHERE status = 'published' AND id <> :id
                ORDER BY (profile IS NOT DISTINCT FROM :profile) DESC, (type = :type) DESC,
                  (sound_status = 'recorded') DESC, ABS(COALESCE(force_g, :noForce) - :force) ASC, id ASC
                LIMIT :limit
                """)
            .param("id", sw.id())
            .param("profile", sw.profile())
            .param("type", sw.type())
            .param("noForce", NO_FORCE)
            .param("force", force)
            .param("limit", limit)
            .query(this::row)
            .list();
    }

    /** Ready recordings of one switch: stock, lubed, foam; press before release. */
    public List<Recording> recordings(UUID switchId) {
        return jdbc.sql("""
                SELECT * FROM catalog.switch_recordings WHERE switch_id = ?
                ORDER BY CASE variant WHEN 'stock' THEN 0 WHEN 'lubed' THEN 1 ELSE 2 END,
                  CASE stroke WHEN 'press' THEN 0 ELSE 1 END
                """)
            .param(switchId)
            .query((rs, n) -> new Recording(rs.getObject("recording_id", UUID.class), rs.getString("variant"),
                    rs.getString("stroke"), rs.getString("url"), (Integer) rs.getObject("duration_ms"),
                    plain(rs.getBigDecimal("loudness_lufs")),
                    List.copyOf(json.readValue(rs.getString("peaks"), PEAKS))))
            .list();
    }

    /** Any switch, drafts too, for the editor (ADM-02). */
    public Optional<SwitchRow> byId(UUID id) {
        return jdbc.sql("SELECT * FROM catalog.switches WHERE id = ?").param(id).query(this::row).optional();
    }

    /**
     * ADM-02 list (drafts too), by name then id, from the cursor on.
     *
     * @param q part of the name or brand, or null
     */
    public List<SwitchRow> listByName(String q, String afterName, UUID afterId, int limit) {
        StringBuilder sql = new StringBuilder("SELECT * FROM catalog.switches WHERE true");
        List<Object> params = new ArrayList<>();
        if (q != null) {
            String like = "%" + likeEscape(q.toLowerCase(Locale.ROOT)) + "%";
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

    private SwitchRow row(ResultSet rs, int rowNum) throws SQLException {
        return new SwitchRow(rs.getObject("id", UUID.class), rs.getString("slug"), rs.getString("name"),
                rs.getString("brand"), rs.getString("type"), rs.getString("profile"), rs.getString("stem_color"),
                plain(rs.getBigDecimal("force_g")), plain(rs.getBigDecimal("actuation_mm")),
                plain(rs.getBigDecimal("travel_mm")), plain(rs.getBigDecimal("bottom_out_g")),
                rs.getString("spring"), rs.getString("housing"),
                List.copyOf(json.readValue(rs.getString("force_curve"), CURVE)), rs.getString("status"),
                rs.getString("sound_status"), instant(rs.getTimestamp("new_until")),
                instant(rs.getTimestamp("published_at")), rs.getLong("version"),
                instant(rs.getTimestamp("updated_at")), rs.getString("photo_url"));
    }

    private static String likeEscape(String text) {
        return text.replace("!", "!!").replace("%", "!%").replace("_", "!_");
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
