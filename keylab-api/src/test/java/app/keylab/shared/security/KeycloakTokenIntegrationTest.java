package app.keylab.shared.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import app.keylab.shared.UserId;
import app.keylab.testing.TestDatabase;
import app.keylab.testing.TestTokens;

import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jwt.JWTClaimsSet;

import dev.playground.testing.KeycloakRealm;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The realm as dev and prod apply it (infra/playground-realm.json through
 * keycloak-config-cli), with Keycloak in Testcontainers: a token Keycloak
 * issues for the gateway client must carry what keylab-api needs, which is
 * the audience keylab-api, a {@code sub}, and the KeyLab realm roles.
 *
 * The gateway client allows only the code flow, so this test switches the
 * password grant on for it in the container's realm. Mappers, scopes and
 * roles stay exactly as the realm file sets them.
 */
@SpringBootTest
@AutoConfigureMockMvc
class KeycloakTokenIntegrationTest {

    private static KeycloakRealm keycloak;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) throws Exception {
        keycloak = KeycloakRealm.start("http://localhost:5174",
                "http://localhost:5174/logout/connect/back-channel/gateway");
        allowPasswordGrantOnTheGatewayClient();
        registry.add("KEYCLOAK_ISSUER_URI", keycloak::issuerUri);
        registry.add("KEYCLOAK_JWK_SET_URI", keycloak::jwkSetUri);
        TestDatabase.register(registry);
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
    void aMemberTokenCarriesTheAudienceASubjectAndTheDefaultKeylabRole() throws Exception {
        String token = token(KeycloakRealm.USER_EMAIL, KeycloakRealm.USER_PASSWORD);
        JWTClaimsSet claims = TestTokens.unverifiedClaims(token);

        assertThat(claims.getAudience()).contains("keylab-api");
        // users.id is the Keycloak sub: it must be there and be a UUID.
        assertThat(UserId.of(claims.getSubject()).value()).isInstanceOf(UUID.class);
        assertThat(realmRoles(claims)).contains("keylab-user").doesNotContain("keylab-viewer");

        mvc.perform(get("/v1/health").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.authenticated").value(true))
            .andExpect(jsonPath("$.roles.length()").value(1))
            .andExpect(jsonPath("$.roles[0]").value("keylab-user"));
        mvc.perform(get("/v1/admin/anything").header("Authorization", "Bearer " + token))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.code").value("forbidden"));
    }

    @Test
    void theAdminRoleBringsEditorAndViewerWithIt() throws Exception {
        String token = token(KeycloakRealm.ADMIN_EMAIL, KeycloakRealm.ADMIN_PASSWORD);

        // Granted keylab-admin only; the realm's composites add the two below it.
        assertThat(realmRoles(TestTokens.unverifiedClaims(token)))
            .contains("keylab-user", "keylab-viewer", "keylab-editor", "keylab-admin");

        mvc.perform(get("/v1/health").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.roles.length()").value(4));
        // Past the role rule: 404 because no admin endpoint exists yet, not 403.
        mvc.perform(get("/v1/admin/anything").header("Authorization", "Bearer " + token))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("not_found"));
    }

    @Test
    void aKeycloakTokenWithABrokenSignatureIsUnauthorized() throws Exception {
        String token = token(KeycloakRealm.USER_EMAIL, KeycloakRealm.USER_PASSWORD);
        mvc.perform(get("/v1/health").header("Authorization", "Bearer " + TestTokens.withBrokenSignature(token)))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.code").value("unauthenticated"));
    }

    @SuppressWarnings("unchecked")
    private static List<String> realmRoles(JWTClaimsSet claims) throws Exception {
        return (List<String>) claims.getJSONObjectClaim("realm_access").get("roles");
    }

    private static void allowPasswordGrantOnTheGatewayClient() throws Exception {
        HttpResponse<String> found = keycloak.admin("GET", "/clients?clientId=gateway", null);
        String id = JsonPath.read(found.body(), "$[0].id");
        HttpResponse<String> updated = keycloak.admin("PUT", "/clients/" + id,
                "{\"clientId\":\"gateway\",\"directAccessGrantsEnabled\":true}");
        if (updated.statusCode() != 204) {
            throw new IllegalStateException("Client update failed: HTTP " + updated.statusCode() + " " + updated.body());
        }
    }

    private static String token(String username, String password) throws Exception {
        HttpResponse<String> res = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create(keycloak.issuerUri() + "/protocol/openid-connect/token"))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(KeycloakRealm.formBody(Map.of(
                            "grant_type", "password", "client_id", "gateway",
                            "client_secret", KeycloakRealm.GATEWAY_CLIENT_SECRET,
                            "username", username, "password", password, "scope", "openid"))))
                    .build(),
                HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) {
            throw new IllegalStateException("Token request failed: HTTP " + res.statusCode() + " " + res.body());
        }
        return JsonPath.read(res.body(), "$.access_token");
    }
}
