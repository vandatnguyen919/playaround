package app.keylab.catalog.persistence;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import app.keylab.catalog.domain.LibraryFilter;
import app.keylab.catalog.domain.LibraryFilter.Sort;
import app.keylab.catalog.domain.Recording;
import app.keylab.catalog.domain.Switch;
import app.keylab.shared.paging.Cursor;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * The public library's reads (CAT-01 to CAT-04) and catalog's copy of the
 * ready recordings. Only {@code status = 'published'} rows ever leave here
 * for the public side: drafts and pulled switches stay with the editors.
 */
@Repository
public class LibraryRepository {

    /** Sorts switches with no force after every real one. */
    private static final BigDecimal NO_FORCE = new BigDecimal("1000");
    private static final TypeReference<List<Double>> PEAKS = new TypeReference<>() {
    };

    private final JdbcClient jdbc;
    private final JsonMapper json;
    private final SwitchRepository switches;

    LibraryRepository(JdbcClient jdbc, JsonMapper json, SwitchRepository switches) {
        this.jdbc = jdbc;
        this.json = json;
        this.switches = switches;
    }

    /**
     * One page of published switches, plus one more row to tell whether a next
     * page exists. {@code after} is the last row of the previous page in the
     * same sort.
     */
    public List<Switch> published(LibraryFilter filter, Cursor after, int limit, Instant now) {
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
        return jdbc.sql(sql.toString()).params(params).query(switches::row).list();
    }

    /** The cursor that continues after {@code sw} in {@code sort}; it names the sort it belongs to. */
    public static Cursor cursorAfter(Switch sw, Sort sort) {
        if (sort == Sort.force) {
            BigDecimal force = sw.specs().forceG() == null ? NO_FORCE : sw.specs().forceG();
            return Cursor.of(sort.wire(), force.toPlainString(), sw.id());
        }
        return Cursor.of(sort.wire(), sw.publishedAt(), sw.id());
    }

    public Optional<Switch> publishedBySlug(String slug) {
        return jdbc.sql("SELECT * FROM catalog.switches WHERE slug = ? AND status = 'published'")
            .param(slug).query(switches::row).optional();
    }

    /**
     * Published switches that sound most like {@code sw} (CAT-04): the same
     * sound profile first, then the same type, then recorded before missing,
     * then the nearest actuation force. Never {@code sw} itself.
     */
    public List<Switch> related(Switch sw, int limit) {
        BigDecimal force = sw.specs().forceG() == null ? NO_FORCE : sw.specs().forceG();
        return jdbc.sql("""
                SELECT * FROM catalog.switches WHERE status = 'published' AND id <> :id
                ORDER BY (profile IS NOT DISTINCT FROM :profile) DESC, (type = :type) DESC,
                  (sound_status = 'recorded') DESC, ABS(COALESCE(force_g, :noForce) - :force) ASC, id ASC
                LIMIT :limit
                """)
            .param("id", sw.id())
            .param("profile", sw.specs().profile() == null ? null : sw.specs().profile().name())
            .param("type", sw.specs().type().name())
            .param("noForce", NO_FORCE)
            .param("force", force)
            .param("limit", limit)
            .query(switches::row)
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

    /**
     * Keeps a ready recording, unless a later one for the same slot is
     * already here (events may arrive late or twice). A switch that is gone
     * keeps nothing.
     */
    /**
     * Locks the switch row until the transaction ends, so two recordings that
     * finish at once update its sound status one after the other; otherwise
     * each would count only its own row and leave "missing".
     *
     * @return false when the switch is gone
     */
    public boolean lockSwitch(UUID switchId) {
        return jdbc.sql("SELECT id FROM catalog.switches WHERE id = ? FOR UPDATE").param(switchId)
            .query(UUID.class).optional().isPresent();
    }

    public void saveReady(UUID switchId, String variant, String stroke, UUID recordingId, String url,
            Integer durationMs, BigDecimal loudnessLufs, List<Double> peaks, Instant processedAt) {
        jdbc.sql("""
                INSERT INTO catalog.switch_recordings (switch_id, variant, stroke, recording_id, url, duration_ms,
                  loudness_lufs, peaks, processed_at)
                SELECT :switchId, :variant, :stroke, :recordingId, :url, :durationMs, :loudness,
                  CAST(:peaks AS jsonb), :processedAt
                WHERE EXISTS (SELECT 1 FROM catalog.switches WHERE id = :switchId)
                ON CONFLICT (switch_id, variant, stroke) DO UPDATE SET recording_id = excluded.recording_id,
                  url = excluded.url, duration_ms = excluded.duration_ms, loudness_lufs = excluded.loudness_lufs,
                  peaks = excluded.peaks, processed_at = excluded.processed_at
                WHERE switch_recordings.processed_at <= excluded.processed_at
                """)
            .param("switchId", switchId)
            .param("variant", variant)
            .param("stroke", stroke)
            .param("recordingId", recordingId)
            .param("url", url)
            .param("durationMs", durationMs)
            .param("loudness", loudnessLufs)
            .param("peaks", json.writeValueAsString(peaks))
            .param("processedAt", Timestamp.from(processedAt))
            .update();
    }

    /**
     * "recorded" once the stock press and release are both here, else
     * "missing". Not a change an editor makes, so the row version (the admin
     * ETag) stays: an editor uploading sounds can still save the specs.
     */
    public void refreshSoundStatus(UUID switchId) {
        jdbc.sql("""
                UPDATE catalog.switches SET sound_status = CASE WHEN (
                  SELECT count(*) FROM catalog.switch_recordings
                  WHERE switch_id = :id AND variant = 'stock') = 2 THEN 'recorded' ELSE 'missing' END
                WHERE id = :id
                """)
            .param("id", switchId)
            .update();
    }

    private static String likeEscape(String text) {
        return text.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    private static BigDecimal plain(BigDecimal value) {
        return SwitchRepository.plain(value);
    }
}
