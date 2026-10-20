package dev.playground.gateway;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.authority.mapping.GrantedAuthoritiesMapper;
import org.springframework.security.oauth2.core.oidc.user.OidcUserAuthority;

final class RealmRoleAuthoritiesMapper implements GrantedAuthoritiesMapper {

    @Override
    public Collection<? extends GrantedAuthority> mapAuthorities(
            Collection<? extends GrantedAuthority> authorities) {
        List<GrantedAuthority> mapped = new ArrayList<>();
        authorities.stream()
                .filter(OidcUserAuthority.class::isInstance)
                .map(OidcUserAuthority.class::cast)
                .map(OidcUserAuthority::getAttributes)
                .forEach(attributes -> addRoles(mapped, attributes.get("realm_access")));
        return mapped;
    }

    private void addRoles(List<GrantedAuthority> mapped, Object claim) {
        if (claim instanceof Map<?, ?> realmAccess
                && realmAccess.get("roles") instanceof List<?> roles) {
            roles.stream()
                    .filter(String.class::isInstance)
                    .map(String.class::cast)
                    .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                    .forEach(mapped::add);
        }
    }
}
