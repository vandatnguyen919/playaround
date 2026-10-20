package dev.playground.gateway;

import reactor.core.publisher.Mono;

import org.springframework.security.web.server.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;

@RestController
class CsrfController {

    /**
     * Forces the deferred CSRF token to load, which writes the XSRF-TOKEN
     * cookie the SPA (via Axios) echoes back in the X-XSRF-TOKEN header.
     */
    @GetMapping("/bff/csrf")
    Mono<CsrfToken> csrf(ServerWebExchange exchange) {
        Mono<CsrfToken> csrfToken = exchange.getAttribute(CsrfToken.class.getName());
        return (csrfToken != null) ? csrfToken : Mono.empty();
    }
}
