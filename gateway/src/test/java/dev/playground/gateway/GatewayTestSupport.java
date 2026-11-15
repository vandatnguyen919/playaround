package dev.playground.gateway;

import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import reactor.core.publisher.Mono;
import reactor.netty.DisposableServer;
import reactor.netty.http.server.HttpServer;

import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.MountableFile;

import org.springframework.test.context.DynamicPropertyRegistry;

/**
 * Shared pieces for the gateway integration tests: Redis started with the
 * real config and ACL from infra/redis, a stub API and keylab-api, and stub Keycloak
 * endpoints so no identity provider has to run.
 */
final class GatewayTestSupport {

    static final String REDIS_PASSWORD = "test-redis-password";

    static final GenericContainer<?> REDIS = new GenericContainer<>("redis:8.10-alpine")
            .withCopyFileToContainer(MountableFile.forHostPath(Path.of("../infra/redis/redis.conf")),
                    "/usr/local/etc/redis/redis.conf")
            .withCopyFileToContainer(MountableFile.forHostPath(Path.of("../infra/redis/start.sh")),
                    "/usr/local/etc/redis/start.sh")
            .withEnv("REDIS_PASSWORD", REDIS_PASSWORD)
            .withCreateContainerCmdModifier((cmd) -> cmd.withEntrypoint("/bin/sh", "/usr/local/etc/redis/start.sh"))
            .withExposedPorts(6379)
            .waitingFor(Wait.forLogMessage(".*Ready to accept connections.*", 1));

    static final AtomicInteger API_CALLS = new AtomicInteger();

    static final AtomicInteger KEYLAB_CALLS = new AtomicInteger();

    // What the last keylab-api health call carried: "none" when no token was relayed.
    static final AtomicReference<String> KEYLAB_AUTHORIZATION = new AtomicReference<>();

    // Stub Keycloak: only the discovery document, read at startup. Its
    // endpoints are never called by these tests.
    // /api/me answers at once, /api/slow after 4 s (past the 3 s time limit),
    // /api/lagging after 1.5 s (within it), /api/fail with a 500.
    static final DisposableServer API = HttpServer.create().port(0)
            .route((routes) -> routes
                    .get("/realms/test/.well-known/openid-configuration", (request, response) -> {
                        String issuer = "http://localhost:" + request.hostAddress().getPort() + "/realms/test";
                        return response.header("Content-Type", "application/json").sendString(Mono.just("""
                                {"issuer":"%1$s","authorization_endpoint":"%1$s/auth","token_endpoint":"%1$s/token",
                                 "jwks_uri":"%1$s/certs","userinfo_endpoint":"%1$s/userinfo",
                                 "end_session_endpoint":"%1$s/logout","response_types_supported":["code"],
                                 "subject_types_supported":["public"],"id_token_signing_alg_values_supported":["RS256"]}
                                """.formatted(issuer)));
                    })
                    .get("/api/me", (request, response) -> {
                        API_CALLS.incrementAndGet();
                        return response.header("Content-Type", "application/json")
                                .sendString(Mono.just("{\"name\":\"Test User\"}"));
                    })
                    .get("/api/slow", (request, response) -> {
                        API_CALLS.incrementAndGet();
                        return response.sendString(Mono.delay(Duration.ofSeconds(4)).thenReturn("late"));
                    })
                    .get("/api/lagging", (request, response) -> {
                        API_CALLS.incrementAndGet();
                        return response.sendString(Mono.delay(Duration.ofMillis(1500)).thenReturn("ok"));
                    })
                    .get("/api/fail", (request, response) -> {
                        API_CALLS.incrementAndGet();
                        return response.status(500).send();
                    })
                    // keylab-api on the same stub server, with keylab-api's own paths.
                    .get("/v1/health", (request, response) -> {
                        KEYLAB_CALLS.incrementAndGet();
                        String authorization = request.requestHeaders().get("Authorization");
                        KEYLAB_AUTHORIZATION.set((authorization != null) ? authorization : "none");
                        return response.header("Content-Type", "application/json")
                                .header("KeyLab-API-Revision", "2026-11-08")
                                .sendString(Mono.just("{\"status\":\"ok\"}"));
                    })
                    .get("/v1/builds/{id}", (request, response) -> {
                        KEYLAB_CALLS.incrementAndGet();
                        return response.status(401).header("Content-Type", "application/problem+json")
                                .header("WWW-Authenticate", "Bearer")
                                .sendString(Mono.just("{\"status\":401,\"code\":\"unauthenticated\"}"));
                    })
                    .post("/v1/builds", (request, response) -> {
                        KEYLAB_CALLS.incrementAndGet();
                        return response.status(201).send();
                    })
                    .get("/v1/slow", (request, response) -> {
                        KEYLAB_CALLS.incrementAndGet();
                        return response.sendString(Mono.delay(Duration.ofSeconds(4)).thenReturn("late"));
                    })
                    .get("/v1/fail", (request, response) -> {
                        KEYLAB_CALLS.incrementAndGet();
                        return response.status(500).send();
                    }))
            .bindNow();

    private GatewayTestSupport() {
    }

    static void common(DynamicPropertyRegistry registry) {
        registry.add("KEYCLOAK_ISSUER_URI", () -> "http://localhost:" + API.port() + "/realms/test");
        registry.add("API_URL", () -> "http://localhost:" + API.port());
        registry.add("KEYLAB_API_URL", () -> "http://localhost:" + API.port());
        registry.add("SPA_LOCATION", () -> "classpath:/spa/");
        registry.add("management.server.port", () -> "0");
    }

    static void redis(DynamicPropertyRegistry registry) {
        REDIS.start();
        registry.add("REDIS_HOST", REDIS::getHost);
        registry.add("REDIS_PORT", () -> REDIS.getMappedPort(6379));
        registry.add("REDIS_PASSWORD", () -> REDIS_PASSWORD);
    }

    // Runs redis-cli in the container as the gateway user. The password goes
    // in through REDISCLI_AUTH, as in the compose healthcheck.
    static String redisCli(String command) throws Exception {
        return REDIS.execInContainer("sh", "-c",
                "REDISCLI_AUTH=\"$REDIS_PASSWORD\" redis-cli --no-auth-warning --user gateway " + command)
            .getStdout().trim();
    }
}
