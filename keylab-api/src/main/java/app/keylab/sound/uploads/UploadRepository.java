package app.keylab.sound.uploads;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Uploads in {@code sound.uploads}, by plain SQL. */
@Repository
class UploadRepository {

    private final JdbcClient jdbc;

    UploadRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void insert(Upload upload) {
        jdbc.sql("""
                INSERT INTO sound.uploads (id, purpose, content_type, file_name, created_by, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """)
            .params(upload.id(), upload.purpose().name(), upload.contentType(), upload.fileName(), upload.createdBy(),
                    Timestamp.from(upload.createdAt()), Timestamp.from(upload.expiresAt()))
            .update();
    }

    Optional<Upload> find(UUID id) {
        return jdbc.sql("SELECT * FROM sound.uploads WHERE id = ?").param(id).query(UploadRepository::row).optional();
    }

    /** Locks the row for a use, so two requests cannot both take one upload. */
    Optional<Upload> lock(UUID id) {
        return jdbc.sql("SELECT * FROM sound.uploads WHERE id = ? FOR UPDATE").param(id)
            .query(UploadRepository::row).optional();
    }

    /** @return false when the upload was used meanwhile */
    boolean received(UUID id, long size, String sha256, Instant now) {
        return jdbc.sql("""
                UPDATE sound.uploads SET status = 'received', size_bytes = ?, sha256 = ?, received_at = ?
                WHERE id = ? AND status <> 'used'
                """)
            .params(size, sha256, Timestamp.from(now), id)
            .update() == 1;
    }

    void used(UUID id) {
        jdbc.sql("UPDATE sound.uploads SET status = 'used' WHERE id = ?").param(id).update();
    }

    private static Upload row(ResultSet rs, int rowNum) throws SQLException {
        Long size = rs.getObject("size_bytes", Long.class);
        return new Upload(rs.getObject("id", UUID.class), Upload.Purpose.valueOf(rs.getString("purpose")),
                rs.getString("content_type"), rs.getString("file_name"), Upload.Status.valueOf(rs.getString("status")),
                size, rs.getString("sha256"), rs.getString("created_by"),
                rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("expires_at").toInstant());
    }
}
