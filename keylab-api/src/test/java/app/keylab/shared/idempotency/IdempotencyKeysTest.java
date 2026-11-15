package app.keylab.shared.idempotency;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import app.keylab.shared.idempotency.IdempotencyKeys.Stored;
import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;
import app.keylab.testing.IntegrationTest;

import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

/** Idempotency-Key: a replay within 24 hours returns the first result. Against real Postgres. */
class IdempotencyKeysTest extends IntegrationTest {

    @Autowired
    IdempotencyKeys keys;

    @Autowired
    JdbcClient jdbc;

    private final String scope = "test:" + UUID.randomUUID();
    private final AtomicInteger runs = new AtomicInteger();

    private Stored create() {
        int n = runs.incrementAndGet();
        return new Stored(201, "/v1/builds/" + n, "{\"id\":" + n + "}");
    }

    @Test
    void aReplayReturnsTheFirstResultAndRunsNothing() {
        String hash = IdempotencyKeys.hash("{\"name\":\"Night Thock\"}");

        Stored first = keys.execute(scope, "key-1", hash, this::create);
        Stored replay = keys.execute(scope, "key-1", hash, this::create);

        assertThat(runs).hasValue(1);
        assertThat(replay).isEqualTo(first).isEqualTo(new Stored(201, "/v1/builds/1", "{\"id\":1}"));
    }

    @Test
    void anotherKeyOrAnotherScopeRunsAgain() {
        String hash = IdempotencyKeys.hash("body");
        keys.execute(scope, "key-1", hash, this::create);
        keys.execute(scope, "key-2", hash, this::create);
        keys.execute(scope + ":someone-else", "key-1", hash, this::create);
        assertThat(runs).hasValue(3);
    }

    @Test
    void noKeyMeansNoReplayProtection() {
        keys.execute(scope, null, "h", this::create);
        keys.execute(scope, " ", "h", this::create);
        assertThat(runs).hasValue(2);
    }

    @Test
    void theSameKeyWithADifferentRequestIsRefused() {
        keys.execute(scope, "key-1", IdempotencyKeys.hash("first body"), this::create);

        assertThatThrownBy(() -> keys.execute(scope, "key-1", IdempotencyKeys.hash("other body"), this::create))
            .isInstanceOfSatisfying(ApiProblem.class, (problem) -> {
                assertThat(problem.type()).isEqualTo(ProblemTypes.VALIDATION);
                assertThat(problem.code()).isEqualTo("idempotency_key_reused");
            });
        assertThat(runs).hasValue(1);
    }

    @Test
    void aFailedFirstRequestReleasesTheKey() {
        assertThatThrownBy(() -> keys.execute(scope, "key-1", "h", () -> {
            throw new IllegalStateException("create failed");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(keys.execute(scope, "key-1", "h", this::create).status()).isEqualTo(201);
        assertThat(runs).hasValue(1);
    }

    @Test
    void aSecondRequestWhileTheFirstStillRunsIsAConflict() {
        keys.execute(scope, "key-1", "h", () -> {
            assertThatThrownBy(() -> keys.execute(scope, "key-1", "h", this::create))
                .isInstanceOfSatisfying(ApiProblem.class, (problem) -> {
                    assertThat(problem.type()).isEqualTo(ProblemTypes.CONFLICT);
                    assertThat(problem.code()).isEqualTo("idempotency_in_progress");
                });
            return create();
        });
        assertThat(runs).hasValue(1);
    }

    @Test
    void aKeyOver64CharactersIsBadRequest() {
        assertThat(keys.execute(scope, "k".repeat(64), "h", this::create).status()).isEqualTo(201);
        assertThatThrownBy(() -> keys.execute(scope, "k".repeat(65), "h", this::create))
            .isInstanceOfSatisfying(ApiProblem.class,
                    (problem) -> assertThat(problem.code()).isEqualTo("invalid_idempotency_key"));
        assertThat(runs).hasValue(1);
    }

    @Test
    void afterTheReplayWindowTheKeyRunsAgain() {
        Instant start = Instant.parse("2026-11-08T10:00:00Z");
        IdempotencyKeys day1 = new IdempotencyKeys(jdbc, Clock.fixed(start, ZoneOffset.UTC));
        IdempotencyKeys stillInside = new IdempotencyKeys(jdbc,
                Clock.fixed(start.plus(Duration.ofHours(23).plusMinutes(59)), ZoneOffset.UTC));
        IdempotencyKeys day2 = new IdempotencyKeys(jdbc, Clock.fixed(start.plus(Duration.ofHours(24)), ZoneOffset.UTC));

        day1.execute(scope, "key-1", "h", this::create);
        assertThat(stillInside.execute(scope, "key-1", "h", this::create).location()).isEqualTo("/v1/builds/1");
        assertThat(day2.execute(scope, "key-1", "h", this::create).location()).isEqualTo("/v1/builds/2");
        assertThat(runs).hasValue(2);
    }

    @Test
    void hashesAreStableAndDifferPerBody() {
        assertThat(IdempotencyKeys.hash("a")).isEqualTo(IdempotencyKeys.hash("a")).hasSize(64);
        assertThat(IdempotencyKeys.hash("a")).isNotEqualTo(IdempotencyKeys.hash("b"));
    }
}
