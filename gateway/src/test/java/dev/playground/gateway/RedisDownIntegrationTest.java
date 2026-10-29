package dev.playground.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;

import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * What users get while Redis is down: a clear 503 (HTML for page loads, JSON
 * for the SPA's calls) within a couple of seconds, not a 500 or a hang.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RedisDownIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        GatewayTestSupport.common(registry);
        // Nothing listens on port 1.
        registry.add("REDIS_HOST", () -> "localhost");
        registry.add("REDIS_PORT", () -> "1");
    }

    @Value("${local.server.port}")
    int port;

    @Value("${local.management.port}")
    int managementPort;

    @Test
    void signedInApiCallGetsJson503() {
        long start = System.nanoTime();
        http().get().uri("/bff/me")
            .cookie("SESSION", "some-session-id")
            .accept(MediaType.APPLICATION_JSON)
            .exchange()
            .expectStatus().isEqualTo(503)
            .expectHeader().valueEquals(HttpHeaders.RETRY_AFTER, "30")
            .expectHeader().valueEquals("Content-Security-Policy", SecurityConfig.CONTENT_SECURITY_POLICY)
            .expectBody()
            .jsonPath("$.error").isEqualTo("session_store_unavailable")
            .jsonPath("$.message").isEqualTo(RedisUnavailableHandler.MESSAGE);
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(3));
    }

    @Test
    void startingALoginGetsTheHtmlPage() {
        // The pre-login session cannot be saved.
        http().get().uri("/oauth2/authorization/gateway")
            .accept(MediaType.TEXT_HTML)
            .exchange()
            .expectStatus().isEqualTo(503)
            .expectHeader().contentTypeCompatibleWith(MediaType.TEXT_HTML)
            .expectHeader().valueEquals("Content-Security-Policy", RedisUnavailableHandler.PAGE_CSP)
            // The session was never saved, so no cookie may point at it.
            .expectHeader().doesNotExist(HttpHeaders.SET_COOKIE)
            .expectBody(String.class).value((html) -> assertThat(html)
                .contains("We'll be right back", RedisUnavailableHandler.MESSAGE, "<style>")
                .doesNotContain("Redis", "Exception", "<script", "<link"));
    }

    @Test
    void pageLoadOfASignedInUserGetsTheHtmlPageAndKeepsTheCookie() {
        http().get().uri("/me")
            .cookie("SESSION", "some-session-id")
            .accept(MediaType.TEXT_HTML)
            .exchange()
            .expectStatus().isEqualTo(503)
            .expectHeader().contentTypeCompatibleWith(MediaType.TEXT_HTML)
            // The session may still be in Redis when it comes back: no cookie
            // is cleared, so the user stays signed in.
            .expectHeader().doesNotExist(HttpHeaders.SET_COOKIE);
    }

    @Test
    void spaShellStillLoadsWithoutACookie() {
        http().get().uri("/").accept(MediaType.TEXT_HTML).exchange().expectStatus().isOk();
    }

    @Test
    void livenessStaysUpSoTheContainerIsNotRestartedForARedisOutage() {
        WebTestClient management = WebTestClient.bindToServer()
            .baseUrl("http://localhost:" + this.managementPort).build();
        management.get().uri("/actuator/health/liveness").exchange().expectStatus().isOk();
        management.get().uri("/actuator/health").exchange().expectStatus().isEqualTo(503);
    }

    private WebTestClient http() {
        return WebTestClient.bindToServer().baseUrl("http://localhost:" + this.port)
            .responseTimeout(Duration.ofSeconds(10)).build();
    }
}
