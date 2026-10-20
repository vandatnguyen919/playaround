package dev.playground.api;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

final class RealmRoleAuthoritiesConverter implements Converter<Jwt, Collection<GrantedAuthority>> {

    @Override
    public Collection<GrantedAuthority> convert(Jwt jwt) {
        List<GrantedAuthority> authorities = new ArrayList<>();
        addRoles(authorities, jwt.getClaim("realm_access"));
        addRoles(authorities, jwt.getClaim("roles"));
        return authorities;
    }

    private void addRoles(List<GrantedAuthority> authorities, Object claim) {
        Object roles = claim instanceof Map<?, ?> map ? map.get("roles") : claim;
        if (roles instanceof List<?> roleList) {
            roleList.stream()
                    .filter(String.class::isInstance)
                    .map(String.class::cast)
                    .map(role -> new SimpleGrantedAuthority("ROLE_" + role))
                    .forEach(authorities::add);
        }
    }
}
