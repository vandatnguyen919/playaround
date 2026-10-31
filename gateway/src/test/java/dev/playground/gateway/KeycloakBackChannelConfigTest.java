package dev.playground.gateway;

import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import org.springframework.security.oauth2.client.registration.ClientRegistration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

class KeycloakBackChannelConfigTest {

    private static final String PUBLIC = "https://auth.example.com/realms/playground";

    private static final String PRIVATE = "http://keycloak:8080/realms/playground";

    // What Keycloak answers on the private URL with KC_HOSTNAME set and
    // KC_HOSTNAME_BACKCHANNEL_DYNAMIC on.
    private static Map<String, Object> metadata(String issuer) {
        return Map.of(
                "issuer", issuer,
                "authorization_endpoint", PUBLIC + "/protocol/openid-connect/auth",
                "token_endpoint", PRIVATE + "/protocol/openid-connect/token",
                "jwks_uri", PRIVATE + "/protocol/openid-connect/certs",
                "userinfo_endpoint", PRIVATE + "/protocol/openid-connect/userinfo",
                "end_session_endpoint", PUBLIC + "/protocol/openid-connect/logout",
                "response_types_supported", List.of("code"),
                "subject_types_supported", List.of("public"),
                "id_token_signing_alg_values_supported", List.of("RS256"));
    }

    @Test
    void browserEndpointsArePublicAndServerEndpointsPrivate() {
        ClientRegistration registration = KeycloakBackChannelConfig.registration(metadata(PUBLIC), PUBLIC,
                "gateway", "secret", "{baseUrl}/login/oauth2/code/{registrationId}", Set.of("openid", "email"));

        ClientRegistration.ProviderDetails provider = registration.getProviderDetails();
        assertThat(registration.getRegistrationId()).isEqualTo("gateway");
        assertThat(provider.getIssuerUri()).isEqualTo(PUBLIC);
        assertThat(provider.getAuthorizationUri()).startsWith(PUBLIC);
        assertThat(provider.getTokenUri()).startsWith(PRIVATE);
        assertThat(provider.getJwkSetUri()).startsWith(PRIVATE);
        // RP-initiated logout reads the end session endpoint from here.
        assertThat(provider.getConfigurationMetadata().get("end_session_endpoint"))
                .isEqualTo(PUBLIC + "/protocol/openid-connect/logout");
        assertThat(registration.getScopes()).containsExactlyInAnyOrder("openid", "email");
    }

    @Test
    void refusesAnotherIssuer() {
        assertThatIllegalStateException().isThrownBy(() -> KeycloakBackChannelConfig.registration(metadata(PRIVATE),
                PUBLIC, "gateway", "secret", "{baseUrl}/login/oauth2/code/{registrationId}", Set.of("openid")));
    }
}
