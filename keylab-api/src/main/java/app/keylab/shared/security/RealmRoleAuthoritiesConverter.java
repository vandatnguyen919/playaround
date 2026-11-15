package app.keylab.shared.security;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Keycloak realm roles ({@code realm_access.roles}) as authorities:
 * keylab-user, keylab-viewer, keylab-editor and keylab-admin become
 * ROLE_keylab-user and so on, for {@code hasRole("keylab-editor")}. The realm
 * makes editor include viewer and admin include editor, so the token already
 * lists every role it implies. Same mapping as the playground api.
 */
public final class RealmRoleAuthoritiesConverter implements Converter<Jwt, Collection<GrantedAuthority>> {

    @Override
    public Collection<GrantedAuthority> convert(Jwt jwt) {
        List<GrantedAuthority> authorities = new ArrayList<>();
        Object claim = jwt.getClaim("realm_access");
        Object roles = claim instanceof Map<?, ?> map ? map.get("roles") : null;
        if (roles instanceof List<?> roleList) {
            roleList.stream()
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .map((role) -> new SimpleGrantedAuthority("ROLE_" + role))
                .forEach(authorities::add);
        }
        return authorities;
    }
}
