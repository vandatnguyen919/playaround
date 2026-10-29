package dev.playground.gateway;

import reactor.core.publisher.Mono;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import org.springframework.web.server.WebSession;

/**
 * Saves a started session at the end of the filter chain, before the response
 * commits.
 * <p>
 * WebFlux normally saves the session while the response commits, which for a
 * response without a body (a redirect, a 401) happens after every exception
 * handler has run. A Redis failure there, such as starting a login while
 * Redis is down, could only end as a bare 500. Saved here, the failure
 * reaches {@link RedisUnavailableHandler}. The save at commit then finds
 * nothing left to write.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class SessionSaveWebFilter implements WebFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        return chain.filter(exchange).then(Mono.defer(() -> {
            if (exchange.getResponse().isCommitted()) {
                return Mono.empty();
            }
            // A session that could not even be read was never used by this
            // request; leave that case alone here.
            return exchange.getSession()
                .onErrorResume((ex) -> Mono.empty())
                .filter((session) -> session.isStarted() && !session.isExpired())
                .flatMap(WebSession::save);
        }));
    }
}
