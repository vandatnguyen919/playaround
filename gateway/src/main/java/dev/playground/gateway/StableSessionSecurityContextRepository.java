package dev.playground.gateway;

import java.util.Objects;

import org.jspecify.annotations.NonNull;
import reactor.core.publisher.Mono;

import org.springframework.security.core.context.SecurityContext;
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
 */
final class StableSessionSecurityContextRepository implements ServerSecurityContextRepository {

    private static final String CONTEXT_ATTR =
            WebSessionServerSecurityContextRepository.DEFAULT_SPRING_SECURITY_CONTEXT_ATTR_NAME;

    private final WebSessionServerSecurityContextRepository delegate = new WebSessionServerSecurityContextRepository();

    @Override
    public Mono<SecurityContext> load(@NonNull ServerWebExchange exchange) {
        return this.delegate.load(exchange);
    }

    @Override
    public Mono<Void> save(ServerWebExchange exchange, SecurityContext context) {
        return exchange.getSession().flatMap((session) -> {
            SecurityContext previous = session.getAttribute(CONTEXT_ATTR);
            if (context == null) {
                session.getAttributes().remove(CONTEXT_ATTR);
                return Mono.empty();
            }
            session.getAttributes().put(CONTEXT_ATTR, context);
            return principalChanged(previous, context) ? session.changeSessionId() : Mono.empty();
        });
    }

    private boolean principalChanged(SecurityContext previous, SecurityContext context) {
        if (previous == null || previous.getAuthentication() == null || context.getAuthentication() == null) {
            return true;
        }
        return !Objects.equals(previous.getAuthentication().getName(), context.getAuthentication().getName());
    }
}
