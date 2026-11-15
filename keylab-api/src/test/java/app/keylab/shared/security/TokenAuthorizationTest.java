package app.keylab.shared.security;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;

import app.keylab.testing.IntegrationTest;
import app.keylab.testing.StubJwks;
import app.keylab.testing.TestTokens;

import org.junit.jupiter.api.Test;

import org.springframework.test.web.servlet.ResultActions;

/**
 * Who gets in: only tokens minted for keylab-api (audience), signed by the
 * realm, in date, and with the role the endpoint needs. Every rejection is
 * problem+json with the bearer challenge. Real JWT checks against the stub
 * JWKS; KeycloakTokenIntegrationTest does the same with Keycloak's own tokens.
 */
class TokenAuthorizationTest extends IntegrationTest {

    // --- Audience ---------------------------------------------------------------

    @Test
    void aTokenForKeylabApiIsAccepted() throws Exception {
        getAs("/v1/probe", StubJwks.token(Roles.USER)).andExpect(status().isOk());
    }

    @Test
    void aTokenForAnotherAudienceIsUnauthorized() throws Exception {
        rejected("/v1/probe", TestTokens.sign(StubJwks.KEY,
                StubJwks.claims(Roles.USER).audience(List.of("account", "another-api")).build()));
    }

    @Test
    void aTokenWithNoAudienceIsUnauthorized() throws Exception {
        rejected("/v1/probe", TestTokens.sign(StubJwks.KEY, StubJwks.claims(Roles.USER).audience(List.of()).build()));
    }

    // --- Roles ------------------------------------------------------------------

    @Test
    void keycloakRolesBecomeAuthorities() throws Exception {
        getAs("/v1/health", StubJwks.token("user", Roles.USER, Roles.VIEWER, Roles.EDITOR, Roles.ADMIN))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.authenticated").value(true))
            .andExpect(jsonPath("$.roles.length()").value(4))
            .andExpect(jsonPath("$.roles[0]").value("keylab-admin"))
            .andExpect(jsonPath("$.roles[1]").value("keylab-editor"))
            .andExpect(jsonPath("$.roles[2]").value("keylab-user"))
            .andExpect(jsonPath("$.roles[3]").value("keylab-viewer"));
    }

    @Test
    void aMemberCannotReachAdminEndpoints() throws Exception {
        forbidden("/v1/admin/probe", StubJwks.token(Roles.USER));
    }

    @Test
    void aViewerReachesAdminReadsButNotAnEditorEndpoint() throws Exception {
        String viewer = StubJwks.token(Roles.USER, Roles.VIEWER);
        getAs("/v1/admin/probe", viewer).andExpect(status().isOk());
        forbidden("/v1/admin/probe/editor", viewer);
    }

    @Test
    void anEditorReachesTheEditorEndpoint() throws Exception {
        // As Keycloak issues it: the editor role is a composite that includes viewer.
        getAs("/v1/admin/probe/editor", StubJwks.token(Roles.USER, Roles.VIEWER, Roles.EDITOR))
            .andExpect(status().isOk());
    }

    @Test
    void aTokenWithNoRolesIsStillAuthenticated() throws Exception {
        getAs("/v1/probe", StubJwks.token()).andExpect(status().isOk());
    }

    // --- Guests -----------------------------------------------------------------

    @Test
    void noTokenIsUnauthorizedOnAProtectedEndpoint() throws Exception {
        mvc.perform(get("/v1/probe"))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string("WWW-Authenticate", org.hamcrest.Matchers.startsWith("Bearer")))
            .andExpect(content().contentType("application/problem+json"))
            .andExpect(jsonPath("$.code").value("unauthenticated"))
            .andExpect(jsonPath("$.status").value(401));
    }

    @Test
    void aGuestMayCallHealth() throws Exception {
        mvc.perform(get("/v1/health"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("ok"))
            .andExpect(jsonPath("$.revision").value("2026-11-08"))
            .andExpect(jsonPath("$.authenticated").value(false))
            .andExpect(jsonPath("$.roles.length()").value(0));
    }

    @Test
    void aBadTokenIsUnauthorizedEvenOnThePublicEndpoint() throws Exception {
        rejected("/v1/health", "not-a-jwt");
    }

    // --- Expired, tampered and forged ---------------------------------------------

    @Test
    void anExpiredTokenIsUnauthorized() throws Exception {
        // Five minutes past expiry, well beyond the 60 s clock skew allowed.
        Instant issued = Instant.now().minus(Duration.ofMinutes(10));
        rejected("/v1/probe", TestTokens.sign(StubJwks.KEY, StubJwks.claims(Roles.USER)
            .issueTime(Date.from(issued)).expirationTime(Date.from(issued.plus(Duration.ofMinutes(5)))).build()));
    }

    @Test
    void aMemberTokenEditedToClaimTheAdminRoleIsUnauthorized() throws Exception {
        String escalated = TestTokens.withPayload(StubJwks.token(Roles.USER),
                StubJwks.claims(Roles.USER, Roles.VIEWER, Roles.EDITOR, Roles.ADMIN).build());
        rejected("/v1/admin/probe", escalated);
    }

    @Test
    void aTokenSignedByAnotherKeyIsUnauthorized() throws Exception {
        rejected("/v1/probe", TestTokens.sign(StubJwks.OTHER_KEY, StubJwks.claims(Roles.USER, Roles.ADMIN).build()));
    }

    @Test
    void anUnsignedTokenIsUnauthorized() throws Exception {
        rejected("/v1/probe", TestTokens.unsigned(StubJwks.claims(Roles.USER, Roles.ADMIN).build()));
    }

    @Test
    void aTokenFromAnotherIssuerIsUnauthorized() throws Exception {
        rejected("/v1/probe", TestTokens.sign(StubJwks.KEY,
                StubJwks.claims(Roles.USER).issuer("http://localhost:1/realms/other").build()));
    }

    // ---------------------------------------------------------------------------

    private void rejected(String path, String token) throws Exception {
        problem(getAs(path, token), 401, "unauthenticated")
            .andExpect(header().string("WWW-Authenticate", containsString("invalid_token")));
    }

    private void forbidden(String path, String token) throws Exception {
        problem(getAs(path, token), 403, "forbidden");
    }

    private static ResultActions problem(ResultActions result, int status, String code) throws Exception {
        return result
            .andExpect(status().is(status))
            .andExpect(content().contentType("application/problem+json"))
            .andExpect(jsonPath("$.type").value(org.hamcrest.Matchers.startsWith("https://keylab.app/problems/")))
            .andExpect(jsonPath("$.status").value(status))
            .andExpect(jsonPath("$.code").value(code))
            .andExpect(header().string("KeyLab-API-Revision", "2026-11-08"));
    }
}
