package dev.playground.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.reactive.server.SecurityMockServerConfigurers.mockOidcLogin;
import static org.springframework.security.test.web.reactive.server.SecurityMockServerConfigurers.springSecurity;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cloud.circuitbreaker.resilience4j.ReactiveResilience4JCircuitBreakerFactory;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * The gateway against real Redis (infra/redis config and ACL) and a stub API:
 * security headers, CORS, actuator exposure, session idle timeout in Redis,
 * the rate limiter, and the time limiter and circuit breaker toward the API.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = { "RATE_LIMIT_PER_SECOND=1", "RATE_LIMIT_BURST=15" })
class GatewayHardeningIntegrationTest {

    private static final String APP_ORIGIN = "http://localhost:5174";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        GatewayTestSupport.common(registry);
        GatewayTestSupport.redis(registry);
    }

    @Value("${local.server.port}")
    int port;

    @Value("${local.management.port}")
    int managementPort;

    @Autowired
    ApplicationContext context;

    @Autowired
    ReactiveResilience4JCircuitBreakerFactory circuitBreakers;

    @AfterEach
    void closeCircuit() {
        this.circuitBreakers.getCircuitBreakerRegistry().getAllCircuitBreakers().forEach((cb) -> cb.reset());
    }

    // --- Security headers ---------------------------------------------------

    @Test
    void spaPageCarriesTheSecurityHeaders() {
        http().get().uri("/me").accept(MediaType.TEXT_HTML).exchange()
            .expectStatus().isOk()
            .expectHeader().valueEquals("Content-Security-Policy", SecurityConfig.CONTENT_SECURITY_POLICY)
            .expectHeader().valueEquals("X-Content-Type-Options", "nosniff")
            .expectHeader().valueEquals("X-Frame-Options", "DENY")
            .expectHeader().valueEquals("Referrer-Policy", "same-origin")
            // Plain http: browsers ignore HSTS there, and Spring does not send it.
            .expectHeader().doesNotExist("Strict-Transport-Security")
            .expectBody(String.class).value((html) -> assertThat(html).contains("/assets/index.js"));
    }

    @Test
    void cspAllowsOnlySameOriginCodeAndNoFraming() {
        assertThat(SecurityConfig.CONTENT_SECURITY_POLICY)
            .contains("script-src 'self'", "style-src 'self'", "connect-src 'self'",
                    "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'")
            .doesNotContain("unsafe-inline", "unsafe-eval", "*");
    }

    @Test
    void spaAssetsArePublic() {
        http().get().uri("/assets/index.js").exchange()
            .expectStatus().isOk()
            .expectHeader().valueEquals("X-Content-Type-Options", "nosniff");
    }

    @Test
    void httpsResponsesCarryHsts() {
        WebTestClient https = WebTestClient.bindToApplicationContext(this.context).configureClient()
            .baseUrl("https://localhost").build();
        https.get().uri("/").exchange()
            .expectStatus().isOk()
            .expectHeader().value("Strict-Transport-Security",
                    (hsts) -> assertThat(hsts).startsWith("max-age=31536000").contains("includeSubDomains"));
    }

    // --- CORS -----------------------------------------------------------------

    @Test
    void preflightFromAnotherOriginIsRefused() {
        http().options().uri("/bff/me")
            .header(HttpHeaders.ORIGIN, "https://evil.example")
            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
            .exchange()
            .expectStatus().isForbidden()
            .expectHeader().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN);
    }

    @Test
    void requestFromAnotherOriginIsRefused() {
        // /bff/csrf is public, so only CORS can turn this into a 403.
        http().get().uri("/bff/csrf").header(HttpHeaders.ORIGIN, "https://evil.example").exchange()
            .expectStatus().isForbidden();
        http().get().uri("/bff/csrf").exchange()
            .expectStatus().isOk();
    }

    @Test
    void appOriginPassesCors() {
        http().options().uri("/bff/me")
            .header(HttpHeaders.ORIGIN, APP_ORIGIN)
            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "X-XSRF-TOKEN")
            .exchange()
            .expectStatus().isOk()
            .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, APP_ORIGIN)
            .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS, "true");
    }

    // --- Actuator -------------------------------------------------------------

    @Test
    void actuatorIsNotOnTheAppPort() {
        http().get().uri("/actuator/health").exchange()
            .expectStatus().value((status) -> assertThat(status).isIn(401, 404));
    }

    @Test
    void managementPortServesHealthAndInfoOnly() {
        WebTestClient management = WebTestClient.bindToServer()
            .baseUrl("http://localhost:" + this.managementPort).build();
        management.get().uri("/actuator/health").exchange()
            .expectStatus().isOk()
            .expectBody()
            .jsonPath("$.status").isEqualTo("UP")
            .jsonPath("$.components").doesNotExist();
        management.get().uri("/actuator/health/liveness").exchange().expectStatus().isOk();
        management.get().uri("/actuator/info").exchange().expectStatus().isOk();
        // Not exposed. Security also runs on this port, so they answer 401
        // rather than 404; either way nothing is served.
        for (String hidden : List.of("/actuator/env", "/actuator/beans", "/actuator/gateway/routes",
                "/actuator/configprops", "/actuator/heapdump")) {
            management.get().uri(hidden).exchange()
                .expectStatus().value((status) -> assertThat(status).isIn(401, 404));
        }
    }

    // --- Session ----------------------------------------------------------------

    @Test
    void sessionExpiresInRedisAfterTheIdleTimeout() throws Exception {
        // Starting a login creates the pre-login session.
        ResponseCookie session = http().get().uri("/oauth2/authorization/gateway").exchange()
            .expectStatus().is3xxRedirection()
            .returnResult(Void.class).getResponseCookies().getFirst("SESSION");
        assertThat(session).isNotNull();

        long ttl = Long.parseLong(GatewayTestSupport.redisCli("TTL spring:session:sessions:" + session.getValue()));

        assertThat(ttl).isBetween(Duration.ofMinutes(30).minusSeconds(10).toSeconds(), Duration.ofMinutes(30).toSeconds());
    }

    // --- Rate limiter -------------------------------------------------------------

    @Test
    void rateLimiterAllowsTheBurstThenAnswers429PerUser() throws Exception {
        List<Integer> statuses = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            statuses.add(signedIn("rate-alice").get().uri("/bff/me").exchange()
                .returnResult(String.class).getStatus().value());
        }

        assertThat(statuses.subList(0, 15)).containsOnly(200);
        assertThat(statuses.subList(15, 20)).contains(429);
        // Another user has a bucket of their own.
        signedIn("rate-bob").get().uri("/bff/me").exchange().expectStatus().isOk();
        assertThat(GatewayTestSupport.redisCli("EXISTS request_rate_limiter.{bff-me.user:rate-alice}.tokens")).isEqualTo("1");
    }

    // --- Time limiter and circuit breaker ----------------------------------------

    @Test
    void slowApiCallIsCutOffByTheTimeLimiter() {
        long start = System.nanoTime();
        signedIn("slow-user").get().uri("/api/slow").exchange()
            .expectStatus().isEqualTo(504)
            .expectBody().jsonPath("$.error").isEqualTo("api_timeout");
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofMillis(3900));

        // 1.5 s is inside the 3 s limit (Resilience4j's own default is 1 s).
        signedIn("slow-user").get().uri("/api/lagging").exchange().expectStatus().isOk();
    }

    @Test
    void circuitOpensAfterRepeatedFailuresAndStopsCallingTheApi() {
        WebTestClient client = signedIn("cb-user");
        for (int i = 0; i < 10; i++) {
            client.get().uri("/api/fail").exchange()
                .expectStatus().isEqualTo(502)
                .expectBody().jsonPath("$.error").isEqualTo("api_error");
        }
        int callsBefore = GatewayTestSupport.API_CALLS.get();

        client.get().uri("/api/me").exchange()
            .expectStatus().isEqualTo(503)
            .expectHeader().valueEquals(HttpHeaders.RETRY_AFTER, "15")
            .expectBody().jsonPath("$.error").isEqualTo("api_unavailable");

        assertThat(GatewayTestSupport.API_CALLS.get()).isEqualTo(callsBefore);
    }

    // --- Redis ACL (infra/redis/start.sh) ----------------------------------------

    @Test
    void redisRefusesClientsWithoutCredentials() throws Exception {
        String reply = GatewayTestSupport.REDIS.execInContainer("redis-cli", "GET", "anything").getStdout();
        assertThat(reply).contains("NOAUTH");
    }

    @Test
    void gatewayRedisUserCannotRunDangerousCommandsOrTouchOtherKeys() throws Exception {
        assertThat(GatewayTestSupport.redisCli("FLUSHALL")).contains("NOPERM");
        assertThat(GatewayTestSupport.redisCli("KEYS '*'")).contains("NOPERM");
        assertThat(GatewayTestSupport.redisCli("CONFIG GET requirepass")).contains("NOPERM");
        assertThat(GatewayTestSupport.redisCli("SET other:key 1")).contains("NOPERM");
        assertThat(GatewayTestSupport.redisCli("SET spring:session:probe 1 EX 5")).isEqualTo("OK");
    }

    @Test
    void redisRunsWithTheDocumentedMemoryAndPersistencePolicy() throws Exception {
        String memory = GatewayTestSupport.redisCli("INFO memory");
        assertThat(memory).contains("maxmemory_policy:volatile-ttl", "maxmemory:100663296");
        String persistence = GatewayTestSupport.redisCli("INFO persistence");
        assertThat(persistence).contains("aof_enabled:0");
    }

    private WebTestClient http() {
        return WebTestClient.bindToServer().baseUrl("http://localhost:" + this.port)
            .responseTimeout(Duration.ofSeconds(10)).build();
    }

    // A signed-in user through the real filter chain, routes and Redis.
    private WebTestClient signedIn(String subject) {
        return WebTestClient.bindToApplicationContext(this.context)
            .apply(springSecurity())
            .configureClient()
            .responseTimeout(Duration.ofSeconds(10))
            .build()
            .mutateWith(mockOidcLogin()
                .idToken((token) -> token.subject(subject))
                .authorities(new SimpleGrantedAuthority("ROLE_user")));
    }
}
