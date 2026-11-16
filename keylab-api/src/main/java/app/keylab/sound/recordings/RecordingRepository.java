package app.keylab.sound.recordings;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import app.keylab.shared.paging.Cursor;
import app.keylab.shared.paging.PageQuery;
import app.keylab.sound.SoundProcessed;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** Recordings in {@code sound.recordings}, by plain SQL. Lists run newest first. */
@Repository
class RecordingRepository {

    private static final TypeReference<List<Double>> PEAKS = new TypeReference<>() {
    };

    private final JdbcClient jdbc;
    private final JsonMapper json;

    RecordingRepository(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    void insert(UUID id, UUID switchId, SoundProcessed.Variant variant, SoundProcessed.Stroke stroke, UUID uploadId,
            String fileName, String userId, Instant now) {
        jdbc.sql("""
                INSERT INTO sound.recordings (id, switch_id, variant, stroke, upload_id, file_name, created_by,
                  created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """)
            .params(id, switchId, variant.name(), stroke.name(), uploadId, fileName, userId, Timestamp.from(now))
            .update();
    }

    Optional<SoundRecording> find(UUID id) {
        return jdbc.sql("SELECT * FROM sound.recordings WHERE id = ?").param(id).query(this::row).optional();
    }

    Optional<SoundRecording> lock(UUID id) {
        return jdbc.sql("SELECT * FROM sound.recordings WHERE id = ? FOR UPDATE").param(id).query(this::row)
            .optional();
    }

    List<UUID> processing() {
        return jdbc.sql("SELECT id FROM sound.recordings WHERE status = 'processing' ORDER BY created_at")
            .query(UUID.class).list();
    }

    /** ADM-05: newest first, with optional filters; {@code limit} rows from the cursor on. */
    List<SoundRecording> list(String status, UUID switchId, PageQuery page) {
        StringBuilder sql = new StringBuilder("SELECT * FROM sound.recordings WHERE true");
        List<Object> params = new ArrayList<>();
        if (status != null) {
            sql.append(" AND status = ?");
            params.add(status);
        }
        if (switchId != null) {
            sql.append(" AND switch_id = ?");
            params.add(switchId);
        }
        if (page.cursor() != null) {
            sql.append(" AND (created_at, id) < (?, ?)");
            params.add(Timestamp.from(cursorTime(page.cursor())));
            params.add(cursorId(page.cursor()));
        }
        sql.append(" ORDER BY created_at DESC, id DESC LIMIT ?");
        params.add(page.limit());
        return jdbc.sql(sql.toString()).params(params).query(this::row).list();
    }

    static Cursor cursorOf(SoundRecording recording) {
        return Cursor.of(recording.createdAt().toString(), recording.id());
    }

    /** The newest ready take of a slot, leaving out {@code except}. */
    Optional<SoundRecording> newestReady(UUID switchId, SoundProcessed.Variant variant, SoundProcessed.Stroke stroke,
            UUID except) {
        return jdbc.sql("""
                SELECT * FROM sound.recordings
                WHERE switch_id = ? AND variant = ? AND stroke = ? AND status = 'ready' AND id <> ?
                ORDER BY processed_at DESC, id DESC LIMIT 1
                """)
            .params(switchId, variant.name(), stroke.name(), except)
            .query(this::row).optional();
    }

    /** @return false when the recording is gone or no longer processing */
    boolean ready(UUID id, String url, String sha256, int durationMs, BigDecimal loudness, List<Double> peaks,
            Instant now) {
        return jdbc.sql("""
                UPDATE sound.recordings SET status = 'ready', url = ?, sha256 = ?, duration_ms = ?,
                  loudness_lufs = ?, peaks = CAST(? AS jsonb), processed_at = ?
                WHERE id = ? AND status = 'processing'
                """)
            .params(url, sha256, durationMs, loudness, json.writeValueAsString(peaks), Timestamp.from(now), id)
            .update() == 1;
    }

    boolean failed(UUID id, String error, Instant now) {
        return jdbc.sql("""
                UPDATE sound.recordings SET status = 'failed', error = ?, processed_at = ?
                WHERE id = ? AND status = 'processing'
                """)
            .params(error, Timestamp.from(now), id)
            .update() == 1;
    }

    void delete(UUID id) {
        jdbc.sql("DELETE FROM sound.recordings WHERE id = ?").param(id).update();
    }

    private static Instant cursorTime(Cursor cursor) {
        try {
            return Instant.parse(cursor.value(0));
        }
        catch (RuntimeException ex) {
            throw invalidToken();
        }
    }

    private static UUID cursorId(Cursor cursor) {
        try {
            return UUID.fromString(cursor.value(1));
        }
        catch (RuntimeException ex) {
            throw invalidToken();
        }
    }

    private static RuntimeException invalidToken() {
        return app.keylab.shared.problem.ApiProblem.of(app.keylab.shared.problem.ProblemTypes.BAD_REQUEST,
                "invalid_page_token", "page_token is not a token from a previous page");
    }

    private SoundRecording row(ResultSet rs, int rowNum) throws SQLException {
        String peaks = rs.getString("peaks");
        Timestamp processed = rs.getTimestamp("processed_at");
        return new SoundRecording(rs.getObject("id", UUID.class), rs.getObject("switch_id", UUID.class),
                SoundProcessed.Variant.valueOf(rs.getString("variant")),
                SoundProcessed.Stroke.valueOf(rs.getString("stroke")), rs.getObject("upload_id", UUID.class),
                rs.getString("file_name"), SoundRecording.Status.valueOf(rs.getString("status")), rs.getString("url"),
                rs.getObject("duration_ms", Integer.class), rs.getBigDecimal("loudness_lufs"),
                peaks == null ? List.of() : json.readValue(peaks, PEAKS), rs.getString("error"),
                rs.getTimestamp("created_at").toInstant(), processed == null ? null : processed.toInstant());
    }
}
