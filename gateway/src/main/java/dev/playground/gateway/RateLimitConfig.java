package dev.playground.gateway;

import java.net.InetSocketAddress;
import java.security.Principal;

import reactor.core.publisher.Mono;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class RateLimitConfig {

    /**
     * Rate limit bucket for the RequestRateLimiter default filter: the
     * signed-in user, so one user cannot use up another's budget behind a
     * shared address. Falls back to the client address for anonymous calls
     * (behind Traefik that is X-Forwarded-For, via forward-headers-strategy).
     * Buckets are per route and key: Redis keys
     * request_rate_limiter.{routeId.key}.*.
     */
    @Bean
    KeyResolver userOrAddressKeyResolver() {
        return (exchange) -> exchange.getPrincipal()
                .map(Principal::getName)
                .map((name) -> "user:" + name)
                .switchIfEmpty(Mono.justOrEmpty(exchange.getRequest().getRemoteAddress())
                        .map(InetSocketAddress::getAddress)
                        .map((address) -> "ip:" + address.getHostAddress()));
    }
}
