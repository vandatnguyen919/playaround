package dev.playground.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.ServerSocket;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.netty.DisposableServer;
import reactor.netty.http.server.HttpServer;


import dev.playground.testing.Browser;
import dev.playground.testing.KeycloakRealm;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The gateway against real Keycloak (realm applied by keycloak-config-cli),
 * real Redis (infra/redis) and a stub API that records what it receives:
 * login through Keycloak starts a Redis session, the browser holds only the
 * cookie, the gateway relays a Keycloak-signed access token, logout ends the
 * session, and a logout at Keycloak ends it through the back channel.
 *
 * Needs Docker. About a minute, most of it Keycloak's first start.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.DEFINED_PORT)
class GatewayKeycloakIntegrationTest {

    private static final Pattern JWT = Pattern.compile("eyJ[\\w-]+\\.eyJ[\\w-]+\\.[\\w-]+");

    private static final int PORT = freePort();
    private static final String APP = "http://localhost:" + PORT;

    private static final AtomicInteger API_CALLS = new AtomicInteger();
    private static final AtomicReference<String> RELAYED_AUTHORIZATION = new AtomicReference<>();

    // Stands in for the API: records the Authorization header the gateway sends.
    private static final DisposableServer API = HttpServer.create().port(0)
        .route((routes) -> routes.get("/api/me", (request, response) -> {
            API_CALLS.incrementAndGet();
            RELAYED_AUTHORIZATION.set(request.requestHeaders().get("Authorization"));
            return response.header("Content-Type", "application/json")
                .sendString(Mono.just("{\"name\":\"from the stub api\"}"));
        }))
        .bindNow();

    private static KeycloakRealm keycloak;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        // Keycloak posts back-channel logout tokens to the gateway on the host.
        keycloak = KeycloakRealm.start(APP,
                "http://host.docker.internal:" + PORT + "/logout/connect/back-channel/gateway");
        GatewayTestSupport.redis(registry);
        registry.add("server.port", () -> PORT);
        registry.add("management.server.port", () -> "0");
        registry.add("APP_URL", () -> APP);
        registry.add("KEYCLOAK_ISSUER_URI", keycloak::issuerUri);
        registry.add("GATEWAY_CLIENT_SECRET", () -> KeycloakRealm.GATEWAY_CLIENT_SECRET);
        registry.add("API_URL", () -> "http://localhost:" + API.port());
        registry.add("SPA_LOCATION", () -> "classpath:/spa/");
    }

    @AfterAll
    static void stop() {
        API.disposeNow();
        if (keycloak != null) {
            keycloak.close();
        }
    }

    @Test
    void loginStartsARedisSessionAndTheBrowserHoldsOnlyTheCookie() throws Exception {
        Browser browser = new Browser();
        Browser.Page landed = browser.signIn(APP, KeycloakRealm.USER_EMAIL, KeycloakRealm.USER_PASSWORD);

        assertThat(landed.url()).isEqualTo(APP + "/");
        String session = browser.cookies.get("SESSION");
        assertThat(session).as("SESSION cookie after login").isNotBlank();
        assertThat(sessionInRedis(session)).as("session is stored in Redis").isTrue();
        // The gateway's cookies. Keycloak's own (KEYCLOAK_IDENTITY is a JWT) sit
        // on Keycloak's path and never go to the app.
        browser.xhr("GET", APP + "/bff/csrf");
        assertThat(browser.cookies).containsKey("XSRF-TOKEN");
        for (String name : List.of("SESSION", "XSRF-TOKEN")) {
            assertThat(JWT.matcher(browser.cookies.get(name)).find()).as("cookie %s holds no JWT", name).isFalse();
        }
    }

    @Test
    void theGatewayRelaysAKeycloakSignedAccessTokenToTheApi() throws Exception {
        Browser browser = new Browser();
        browser.signIn(APP, KeycloakRealm.USER_EMAIL, KeycloakRealm.USER_PASSWORD);

        RELAYED_AUTHORIZATION.set(null);
        HttpResponse<String> me = browser.xhr("GET", APP + "/bff/me");
        assertThat(me.statusCode()).isEqualTo(200);
        assertThat(me.body()).contains("from the stub api");
        assertThat(JWT.matcher(me.body()).find()).as("response body holds no JWT").isFalse();

        String authorization = RELAYED_AUTHORIZATION.get();
        assertThat(authorization).as("Authorization header at the API").startsWith("Bearer ");
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(keycloak.jwkSetUri()).build();
        decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer(keycloak.issuerUri()));
        Jwt token = decoder.decode(authorization.substring("Bearer ".length()));
        assertThat(token.getClaimAsString("azp")).isEqualTo("gateway");
        assertThat(token.getClaimAsString("email")).isEqualTo(KeycloakRealm.USER_EMAIL);
        assertThat(token.getClaimAsString("name")).isEqualTo("Alice Anderson");
        Map<String, Object> realmAccess = token.getClaimAsMap("realm_access");
        @SuppressWarnings("unchecked")
        List<Object> roles = (List<Object>) realmAccess.get("roles");
        assertThat(roles).contains("user").doesNotContain("admin");
    }

    @Test
    void withoutASessionNothingIsRelayed() throws Exception {
        int before = API_CALLS.get();
        assertThat(new Browser().xhr("GET", APP + "/bff/me").statusCode()).isEqualTo(401);

        Browser forged = new Browser();
        forged.cookies.put("SESSION", "made-up-session-id");
        assertThat(forged.xhr("GET", APP + "/bff/me").statusCode()).isEqualTo(401);
        assertThat(API_CALLS.get()).as("the API was never called").isEqualTo(before);
    }

    @Test
    void logoutEndsTheSessionAndAnswersWithTheKeycloakEndSessionUrl() throws Exception {
        Browser browser = new Browser();
        browser.signIn(APP, KeycloakRealm.USER_EMAIL, KeycloakRealm.USER_PASSWORD);
        String session = browser.cookies.get("SESSION");

        browser.xhr("GET", APP + "/bff/csrf");
        String xsrf = browser.cookies.remove("XSRF-TOKEN");
        HttpResponse<String> refused = browser.xhr("POST", APP + "/logout");
        assertThat(refused.statusCode()).as("logout without the CSRF header").isEqualTo(403);
        assertThat(sessionInRedis(session)).isTrue();

        browser.cookies.put("XSRF-TOKEN", xsrf);
        HttpResponse<String> logout = browser.xhr("POST", APP + "/logout");
        assertThat(logout.statusCode()).isEqualTo(200);
        String logoutUrl = JsonPath.read(logout.body(), "$.logoutUrl");
        assertThat(logoutUrl).startsWith(keycloak.issuerUri() + "/protocol/openid-connect/logout");
        assertThat(browser.cookies).doesNotContainKey("SESSION");
        assertThat(sessionInRedis(session)).as("session deleted from Redis").isFalse();

        Browser stale = new Browser();
        stale.cookies.put("SESSION", session);
        assertThat(stale.xhr("GET", APP + "/bff/me").statusCode()).isEqualTo(401);

        // Keycloak ends its own session and sends the browser back to the app.
        Browser.Page back = browser.navigate("GET", logoutUrl, null);
        assertThat(back.url()).isEqualTo(APP + "/");
    }

    @Test
    void aLogoutAtKeycloakEndsTheGatewaySessionThroughTheBackChannel() throws Exception {
        // The admin user, so the user's sessions in the other tests are not touched.
        Browser browser = new Browser();
        browser.signIn(APP, KeycloakRealm.ADMIN_EMAIL, KeycloakRealm.ADMIN_PASSWORD);
        String session = browser.cookies.get("SESSION");
        assertThat(browser.xhr("GET", APP + "/bff/me").statusCode()).isEqualTo(200);

        keycloak.logoutUser(KeycloakRealm.ADMIN_EMAIL);

        // Keycloak posts the logout token right away; allow it a few seconds.
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (sessionInRedis(session) && System.nanoTime() < deadline) {
            Thread.sleep(200);
        }
        assertThat(sessionInRedis(session))
            .as(() -> "session deleted by back-channel logout. Keycloak to host.docker.internal:" + PORT + ": "
                + keycloak.canReach("host.docker.internal", PORT) + "\nKeycloak log tail:\n" + tail(keycloak.logs()))
            .isFalse();
        assertThat(browser.xhr("GET", APP + "/bff/me").statusCode()).isEqualTo(401);
    }

    private static boolean sessionInRedis(String id) throws Exception {
        return "1".equals(GatewayTestSupport.redisCli("EXISTS spring:session:sessions:" + id));
    }

    private static String tail(String log) {
        return log.substring(Math.max(0, log.length() - 3000));
    }

    private static int freePort() {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
        catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
