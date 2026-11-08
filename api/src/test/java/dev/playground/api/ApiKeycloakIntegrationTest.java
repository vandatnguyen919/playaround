package dev.playground.api;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;

import com.nimbusds.jwt.JWTClaimsSet;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

import dev.playground.testing.KeycloakRealm;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The API with its real issuer and JWKS configuration pointed at Keycloak in
 * Testcontainers (realm applied by keycloak-config-cli). Tokens come from
 * Keycloak itself, through a password grant client this test adds to the
 * container's realm, because the gateway client allows only the code flow.
 *
 * Expired tokens are covered in ApiTokenAuthorizationTest: a Keycloak token
 * would need a wait past its lifespan plus the API's 60 s clock skew.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ApiKeycloakIntegrationTest {

    private static final String CLIENT = "api-authz-test";

    private static KeycloakRealm keycloak;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) throws Exception {
        keycloak = KeycloakRealm.start("http://localhost:5174",
                "http://localhost:5174/logout/connect/back-channel/gateway");
        keycloak.createPasswordGrantClient(CLIENT);
        registry.add("KEYCLOAK_ISSUER_URI", keycloak::issuerUri);
        registry.add("KEYCLOAK_JWK_SET_URI", keycloak::jwkSetUri);
    }

    @AfterAll
    static void stop() {
        if (keycloak != null) {
            keycloak.close();
        }
    }

    @Autowired
    MockMvc mvc;

    @Test
    void aUserTokenFromKeycloakReadsTheProfileButNotTheAdminEndpoint() throws Exception {
        String token = token(KeycloakRealm.USER_EMAIL, KeycloakRealm.USER_PASSWORD);
        mvc.perform(get("/api/me").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value(KeycloakRealm.USER_EMAIL));
        mvc.perform(get("/api/admin").header("Authorization", "Bearer " + token))
            .andExpect(status().isForbidden());
    }

    @Test
    void anAdminTokenFromKeycloakReachesTheAdminEndpoint() throws Exception {
        String token = token(KeycloakRealm.ADMIN_EMAIL, KeycloakRealm.ADMIN_PASSWORD);
        mvc.perform(get("/api/admin").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk());
    }

    @Test
    void aKeycloakUserTokenEditedToAddTheAdminRoleIsUnauthorized() throws Exception {
        String token = token(KeycloakRealm.USER_EMAIL, KeycloakRealm.USER_PASSWORD);
        JWTClaimsSet original = TestTokens.unverifiedClaims(token);
        JWTClaimsSet escalated = new JWTClaimsSet.Builder(original)
            .claim("realm_access", Map.of("roles", List.of("user", "admin")))
            .build();
        mvc.perform(get("/api/admin").header("Authorization", "Bearer " + TestTokens.withPayload(token, escalated)))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string("WWW-Authenticate", containsString("invalid_token")));
    }

    @Test
    void aKeycloakTokenWithABrokenSignatureIsUnauthorized() throws Exception {
        String token = token(KeycloakRealm.USER_EMAIL, KeycloakRealm.USER_PASSWORD);
        mvc.perform(get("/api/me").header("Authorization", "Bearer " + TestTokens.withBrokenSignature(token)))
            .andExpect(status().isUnauthorized());
    }

    private static String token(String username, String password) throws Exception {
        return keycloak.passwordGrantToken(CLIENT, username, password);
    }
}
