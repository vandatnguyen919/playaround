package app.keylab.shared.web;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * SYS-01, the only endpoint of the foundation. Public, so a guest can call it
 * through the BFF, and it reflects the caller when the gateway relays a token:
 * one call shows the route, the token relay, the audience check and the role
 * mapping all work. A token that is present but invalid still gets 401.
 */
@RestController
class HealthController {

    private final String revision;

    HealthController(@Value("${keylab.api.revision}") String revision) {
        this.revision = revision;
    }

    @GetMapping("/v1/health")
    Health health(Authentication authentication) {
        boolean authenticated = authentication instanceof JwtAuthenticationToken;
        List<String> roles = authenticated
                ? authentication.getAuthorities().stream()
                    .map(GrantedAuthority::getAuthority)
                    .filter((authority) -> authority.startsWith("ROLE_keylab-"))
                    .map((authority) -> authority.substring("ROLE_".length()))
                    .sorted()
                    .toList()
                : List.of();
        return new Health("ok", revision, authenticated, roles);
    }

    /** {@code roles} lists the caller's KeyLab roles only. */
    record Health(String status, String revision, boolean authenticated, List<String> roles) {
    }
}
