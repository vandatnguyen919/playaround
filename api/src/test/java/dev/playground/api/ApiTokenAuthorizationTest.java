package dev.playground.api;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * The API's real JWT checks (no mocked decoder), against a JWKS this test
 * serves, so it can mint tokens Keycloak never would: expired, not yet
 * valid, tampered, unsigned, signed by another key, from another issuer.
 * Every bad token must get 401 with an invalid_token challenge, and a good
 * token without the role must get 403.
 *
 * ApiKeycloakIntegrationTest does the same with tokens from real Keycloak.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ApiTokenAuthorizationTest {

    private static final RSAKey KEY = TestTokens.newKey("test-key");
    // Same key id as the real one: the API must check the signature, not just the id.
    private static final RSAKey OTHER_KEY = TestTokens.newKey("test-key");

    private static final HttpServer JWKS = startJwks();
    private static final String ISSUER = "http://localhost:" + JWKS.getAddress().getPort() + "/realms/playground";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("KEYCLOAK_ISSUER_URI", () -> ISSUER);
        registry.add("KEYCLOAK_JWK_SET_URI", () -> ISSUER + "/protocol/openid-connect/certs");
    }

    @AfterAll
    static void stop() {
        JWKS.stop(0);
    }

    @Autowired
    MockMvc mvc;

    // --- Valid tokens ---------------------------------------------------------

    @Test
    void aValidUserTokenReadsTheProfile() throws Exception {
        call("/api/me", userToken())
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value("user@example.com"))
            .andExpect(jsonPath("$.roles[0]").value("user"));
    }

    @Test
    void aValidUserTokenWithoutTheAdminRoleIsForbidden() throws Exception {
        call("/api/admin", userToken())
            .andExpect(status().isForbidden())
            .andExpect(header().string("WWW-Authenticate", containsString("insufficient_scope")));
    }

    @Test
    void aValidAdminTokenReachesTheAdminEndpoint() throws Exception {
        call("/api/admin", TestTokens.sign(KEY, claims(List.of("user", "admin")).build()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.message").value("admin access granted"));
    }

    @Test
    void aValidTokenWithNoRolesCannotReadTheProfile() throws Exception {
        call("/api/me", TestTokens.sign(KEY, claims(List.of()).build())).andExpect(status().isForbidden());
    }

    // --- Missing, expired and not yet valid ------------------------------------

    @Test
    void noTokenIsUnauthorized() throws Exception {
        mvc.perform(get("/api/me"))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string("WWW-Authenticate", org.hamcrest.Matchers.startsWith("Bearer")));
    }

    @Test
    void aMalformedTokenIsUnauthorized() throws Exception {
        rejected("/api/me", "not-a-jwt");
    }

    @Test
    void anExpiredTokenIsUnauthorized() throws Exception {
        // Five minutes past expiry, well beyond the 60 s clock skew allowed.
        Instant issued = Instant.now().minus(Duration.ofMinutes(10));
        rejected("/api/me", TestTokens.sign(KEY,
                TestTokens.claims(ISSUER, "user@example.com", List.of("user"), issued, issued.plus(Duration.ofMinutes(5)))
                    .build()));
    }

    @Test
    void aTokenNotYetValidIsUnauthorized() throws Exception {
        rejected("/api/me", TestTokens.sign(KEY, claims(List.of("user"))
                .notBeforeTime(java.util.Date.from(Instant.now().plus(Duration.ofMinutes(5)))).build()));
    }

    // --- Tampered and forged ----------------------------------------------------

    @Test
    void aUserTokenEditedToClaimTheAdminRoleIsUnauthorized() throws Exception {
        String original = userToken();
        String escalated = TestTokens.withPayload(original, claims(List.of("user", "admin")).build());
        rejected("/api/admin", escalated);
        rejected("/api/me", escalated);
    }

    @Test
    void aTokenWithABrokenSignatureIsUnauthorized() throws Exception {
        rejected("/api/me", TestTokens.withBrokenSignature(userToken()));
    }

    @Test
    void aTokenSignedByAnotherKeyIsUnauthorized() throws Exception {
        rejected("/api/me", TestTokens.sign(OTHER_KEY, claims(List.of("user", "admin")).build()));
    }

    @Test
    void anUnsignedTokenIsUnauthorized() throws Exception {
        rejected("/api/me", TestTokens.unsigned(claims(List.of("user", "admin")).build()));
    }

    @Test
    void aTokenFromAnotherIssuerIsUnauthorized() throws Exception {
        Instant now = Instant.now();
        rejected("/api/me", TestTokens.sign(KEY, TestTokens.claims("http://localhost:1/realms/other",
                "user@example.com", List.of("user"), now, now.plus(Duration.ofMinutes(5))).build()));
    }

    // ---------------------------------------------------------------------------

    private static JWTClaimsSet.Builder claims(List<String> roles) {
        Instant now = Instant.now();
        return TestTokens.claims(ISSUER, "user@example.com", roles, now, now.plus(Duration.ofMinutes(5)));
    }

    private static String userToken() {
        return TestTokens.sign(KEY, claims(List.of("user")).build());
    }

    private ResultActions call(String path, String token) throws Exception {
        return mvc.perform(get(path).header("Authorization", "Bearer " + token));
    }

    private void rejected(String path, String token) throws Exception {
        call(path, token)
            .andExpect(status().isUnauthorized())
            .andExpect(header().string("WWW-Authenticate", containsString("invalid_token")));
    }

    private static HttpServer startJwks() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
            byte[] body = new JWKSet(KEY.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
            server.createContext("/realms/playground/protocol/openid-connect/certs", (exchange) -> {
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
                exchange.close();
            });
            server.start();
            return server;
        }
        catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
