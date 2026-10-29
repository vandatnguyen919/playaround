package dev.playground.gateway;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Objects;
import java.util.Set;

import org.jspecify.annotations.NonNull;
import reactor.core.publisher.Mono;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.server.context.ServerSecurityContextRepository;
import org.springframework.security.web.server.context.WebSessionServerSecurityContextRepository;
import org.springframework.web.server.ServerWebExchange;

/**
 * Saves the SecurityContext like {@link WebSessionServerSecurityContextRepository}
 * but changes the session id only when the signed-in principal changes.
 * <p>
 * The stock repository rotates the session id on every save to prevent session
 * fixation. That is right at login, but token refreshes also save an updated
 * context. Rotating there makes any parallel request that still carries the old
 * id see an empty session and expire the cookie, which logs the browser out.
 * <p>
 * It also enforces an absolute session timeout. Login stamps the session with
 * the time of sign-in; once that is older than the absolute timeout, the next
 * load invalidates the session however active it is, and the request is
 * anonymous (401). The idle timeout is the session's Redis TTL (SessionConfig).
 */
final class StableSessionSecurityContextRepository implements ServerSecurityContextRepository {

    private static final String CONTEXT_ATTR =
            WebSessionServerSecurityContextRepository.DEFAULT_SPRING_SECURITY_CONTEXT_ATTR_NAME;

    static final String AUTHENTICATED_AT_ATTR = "playground.authenticatedAt";

    private final WebSessionServerSecurityContextRepository delegate = new WebSessionServerSecurityContextRepository();

    private final RealmRoleAuthoritiesMapper roleMapper = new RealmRoleAuthoritiesMapper();

    private final Clock clock;

    private final Duration absoluteTimeout;

    StableSessionSecurityContextRepository(Clock clock, Duration absoluteTimeout) {
        this.clock = clock;
        this.absoluteTimeout = absoluteTimeout;
    }

    @Override
    public Mono<SecurityContext> load(@NonNull ServerWebExchange exchange) {
        return exchange.getSession().flatMap((session) -> {
            Instant authenticatedAt = session.getAttribute(AUTHENTICATED_AT_ATTR);
            if (authenticatedAt != null
                    && !this.clock.instant().isBefore(authenticatedAt.plus(this.absoluteTimeout))) {
                return session.invalidate().then(Mono.empty());
            }
            return this.delegate.load(exchange).map(this::withRealmRoles);
        });
    }

    /**
     * Ensures the mapped realm roles ({@code ROLE_user}, {@code ROLE_admin}) are
     * present on every load. A token refresh re-saves the raw OIDC authorities
     * and can drop them, which would make {@code hasRole(...)} start rejecting a
     * user who still holds the role. Re-deriving them here from the
     * {@code realm_access} claim keeps authorization stable across refreshes.
     */
    private SecurityContext withRealmRoles(SecurityContext context) {
        if (context == null) {
            return context;
        }
        Authentication auth = context.getAuthentication();
        if (!(auth instanceof OAuth2AuthenticationToken oauth2)
                || !(oauth2.getPrincipal() instanceof OidcUser)) {
            return context;
        }
        Set<GrantedAuthority> combined = new LinkedHashSet<>(oauth2.getAuthorities());
        combined.addAll(this.roleMapper.mapAuthorities(oauth2.getAuthorities()));
        if (combined.equals(oauth2.getAuthorities())) {
            return context;
        }
        OAuth2AuthenticationToken remapped =
                new OAuth2AuthenticationToken(oauth2.getPrincipal(), combined,
                        oauth2.getAuthorizedClientRegistrationId());
        remapped.setDetails(oauth2.getDetails());
        return new SecurityContextImpl(remapped);
    }

    @Override
    public Mono<Void> save(ServerWebExchange exchange, SecurityContext context) {
        return exchange.getSession().flatMap((session) -> {
            SecurityContext previous = session.getAttribute(CONTEXT_ATTR);
            if (context == null) {
                session.getAttributes().remove(CONTEXT_ATTR);
                session.getAttributes().remove(AUTHENTICATED_AT_ATTR);
                return Mono.empty();
            }
            session.getAttributes().put(CONTEXT_ATTR, context);
            if (!principalChanged(previous, context)) {
                return Mono.empty();
            }
            // A new sign-in: new session id against fixation, and the start of
            // the absolute timeout.
            session.getAttributes().put(AUTHENTICATED_AT_ATTR, this.clock.instant());
            return session.changeSessionId();
        });
    }

    private boolean principalChanged(SecurityContext previous, SecurityContext context) {
        if (previous == null || previous.getAuthentication() == null || context.getAuthentication() == null) {
            return true;
        }
        return !Objects.equals(previous.getAuthentication().getName(), context.getAuthentication().getName());
    }
}
