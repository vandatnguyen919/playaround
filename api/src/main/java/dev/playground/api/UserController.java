package dev.playground.api;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class UserController {

    @GetMapping({"/api/me", "/api/user"})
    @PreAuthorize("hasRole('user')")
    Map<String, Object> user(@AuthenticationPrincipal Jwt jwt) {
        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("name", jwt.getClaimAsString("name"));
        profile.put("preferredUsername", jwt.getClaimAsString("preferred_username"));
        profile.put("email", jwt.getClaimAsString("email"));
        profile.put("roles", roles(jwt));
        return profile;
    }

    @GetMapping("/api/admin")
    @PreAuthorize("hasRole('admin')")
    Map<String, Object> admin(@AuthenticationPrincipal Jwt jwt) {
        return Map.of("message", "admin access granted", "username",
                jwt.getClaimAsString("preferred_username"));
    }

    private List<String> roles(Jwt jwt) {
        Object rolesClaim = jwt.getClaim("roles");
        if (rolesClaim instanceof List<?> roles) {
            return roles.stream().map(String::valueOf).toList();
        }
        Object realmAccess = jwt.getClaim("realm_access");
        if (realmAccess instanceof Map<?, ?> map && map.get("roles") instanceof List<?> realmRoles) {
            return realmRoles.stream().map(String::valueOf).toList();
        }
        return List.of();
    }
}
