package dev.playground.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.time.Instant;

import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUserAuthority;

class RealmRoleAuthoritiesMapperTest {

    private final RealmRoleAuthoritiesMapper mapper = new RealmRoleAuthoritiesMapper();

    @Test
    void mapsUserRealmRole() {
        assertThat(mapper.mapAuthorities(List.of(authorityWithRoles("user"))))
                .extracting(GrantedAuthority::getAuthority)
                .containsExactly("ROLE_user");
    }

    @Test
    void mapsAdminRealmRoles() {
        assertThat(mapper.mapAuthorities(List.of(authorityWithRoles("user", "admin"))))
                .extracting(GrantedAuthority::getAuthority)
                .containsExactlyInAnyOrder("ROLE_user", "ROLE_admin");
    }

    @Test
    void anonymousHasNoMappedAuthorities() {
        assertThat(mapper.mapAuthorities(List.of())).isEmpty();
    }

    private OidcUserAuthority authorityWithRoles(String... roles) {
        Map<String, Object> claims = Map.of(
                "sub", "test-user",
                "realm_access", Map.of("roles", List.of(roles)));
        OidcIdToken token = new OidcIdToken("id-token", Instant.now(),
                Instant.now().plusSeconds(300), claims);
        return new OidcUserAuthority(token);
    }
}
