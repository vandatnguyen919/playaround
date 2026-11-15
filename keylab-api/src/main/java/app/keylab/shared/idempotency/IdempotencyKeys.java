package app.keylab.shared.idempotency;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.function.Supplier;

import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * {@code Idempotency-Key} on creates: a replay of the same request within
 * 24 hours gets the first result back and nothing is created twice
 * (api-design-v1.md, Conventions, Create).
 *
 * <pre>
 * Stored result = idempotencyKeys.execute("builds:" + userId, key, IdempotencyKeys.hash(body), () -> {
 *     Build build = builds.create(...);
 *     return new Stored(201, "/v1/builds/" + build.id(), json(build));
 * });
 * </pre>
 *
 * Rows live in {@code platform.idempotency_keys}. The key row is written
 * before the action runs, so two requests with one key never both run it.
 * Each statement commits on its own unless the caller holds a transaction.
 */
@Component
public class IdempotencyKeys {

    public static final int MAX_KEY_LENGTH = 64;
    public static final Duration REPLAY_WINDOW = Duration.ofHours(24);

    /** What a replay returns: the first answer's status, Location and JSON body. */
    public record Stored(int status, String location, String body) {
    }

    private final JdbcClient jdbc;
    private final Clock clock;

    @Autowired
    public IdempotencyKeys(JdbcClient jdbc) {
        this(jdbc, Clock.systemUTC());
    }

    IdempotencyKeys(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /**
     * Runs the action once per key.
     *
     * @param scope who and what the key belongs to, for example {@code builds:<user id>},
     *        so one caller's key never replays another caller's result
     * @param key the Idempotency-Key header; null or blank runs the action with no replay protection
     * @param requestHash {@link #hash} of the request body, to catch a key reused for a different request
     * @throws ApiProblem 400 invalid_idempotency_key (too long), 422 idempotency_key_reused
     *         (same key, different request), 409 idempotency_in_progress (the first request is still running)
     */
    public Stored execute(String scope, String key, String requestHash, Supplier<Stored> action) {
        if (key == null || key.isBlank()) {
            return action.get();
        }
        if (key.length() > MAX_KEY_LENGTH) {
            throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "invalid_idempotency_key",
                    "Idempotency-Key is at most " + MAX_KEY_LENGTH + " characters");
        }
        Instant now = clock.instant();
        jdbc.sql("DELETE FROM platform.idempotency_keys WHERE scope = ? AND key = ? AND expires_at <= ?")
            .params(scope, key, Timestamp.from(now))
            .update();
        int claimed = jdbc.sql("""
                INSERT INTO platform.idempotency_keys (scope, key, request_hash, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (scope, key) DO NOTHING
                """)
            .params(scope, key, requestHash, Timestamp.from(now), Timestamp.from(now.plus(REPLAY_WINDOW)))
            .update();
        if (claimed == 0) {
            return replay(scope, key, requestHash);
        }
        Stored result;
        try {
            result = action.get();
        }
        catch (RuntimeException ex) {
            // Nothing was created, so the same key may try again.
            jdbc.sql("DELETE FROM platform.idempotency_keys WHERE scope = ? AND key = ?").params(scope, key).update();
            throw ex;
        }
        jdbc.sql("""
                UPDATE platform.idempotency_keys SET status_code = ?, location = ?, response_body = ?
                WHERE scope = ? AND key = ?
                """)
            .params(result.status(), result.location(), result.body(), scope, key)
            .update();
        return result;
    }

    private Stored replay(String scope, String key, String requestHash) {
        record Row(String requestHash, Integer statusCode, String location, String responseBody) {
        }
        Optional<Row> found = jdbc.sql("""
                SELECT request_hash, status_code, location, response_body
                FROM platform.idempotency_keys WHERE scope = ? AND key = ?
                """)
            .params(scope, key)
            .query((rs, rowNum) -> new Row(rs.getString("request_hash"), (Integer) rs.getObject("status_code"),
                    rs.getString("location"), rs.getString("response_body")))
            .optional();
        // Gone between the insert and this read: the first request failed and released the key.
        Row row = found.orElseThrow(() -> inProgress());
        if (!row.requestHash().equals(requestHash)) {
            throw ApiProblem.of(ProblemTypes.VALIDATION, "idempotency_key_reused",
                    "This Idempotency-Key was already used for a different request");
        }
        if (row.statusCode() == null) {
            throw inProgress();
        }
        return new Stored(row.statusCode(), row.location(), row.responseBody());
    }

    private static ApiProblem inProgress() {
        return ApiProblem.of(ProblemTypes.CONFLICT, "idempotency_in_progress",
                "The first request with this Idempotency-Key is still running. Try again shortly.");
    }

    /** SHA-256 of a request body, hex. */
    public static String hash(String requestBody) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest((requestBody == null ? "" : requestBody).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        }
        catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
