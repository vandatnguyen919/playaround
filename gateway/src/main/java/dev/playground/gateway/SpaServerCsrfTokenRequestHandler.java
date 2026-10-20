package dev.playground.gateway;

import org.jspecify.annotations.NonNull;
import reactor.core.publisher.Mono;

import org.springframework.security.web.server.csrf.CsrfToken;
import org.springframework.security.web.server.csrf.ServerCsrfTokenRequestAttributeHandler;
import org.springframework.security.web.server.csrf.ServerCsrfTokenRequestHandler;
import org.springframework.security.web.server.csrf.XorServerCsrfTokenRequestAttributeHandler;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ServerWebExchange;

/**
 * SPA variant of the CSRF request handler, following the Spring Security
 * reference docs. The deferred token loads the raw token into the XSRF-TOKEN
 * cookie, tokens sent in the X-XSRF-TOKEN header are compared raw, and form
 * parameter tokens are unmasked (BREACH protected).
 */
final class SpaServerCsrfTokenRequestHandler implements ServerCsrfTokenRequestHandler {

    private final ServerCsrfTokenRequestHandler plain = new ServerCsrfTokenRequestAttributeHandler();

    private final ServerCsrfTokenRequestHandler xor = new XorServerCsrfTokenRequestAttributeHandler();

    @Override
    public void handle(@NonNull ServerWebExchange exchange, @NonNull Mono<CsrfToken> csrfToken) {
        this.plain.handle(exchange, csrfToken);
    }

    @Override
    public Mono<String> resolveCsrfTokenValue(ServerWebExchange exchange, CsrfToken csrfToken) {
        String headerValue = exchange.getRequest().getHeaders().getFirst(csrfToken.getHeaderName());
        return (StringUtils.hasText(headerValue) ? this.plain : this.xor).resolveCsrfTokenValue(exchange, csrfToken);
    }
}
