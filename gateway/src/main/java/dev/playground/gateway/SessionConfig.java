package dev.playground.gateway;

import java.time.Clock;
import java.time.Duration;

import io.lettuce.core.ClientOptions;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.data.redis.autoconfigure.LettuceClientOptionsBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.session.config.ReactiveSessionRepositoryCustomizer;
import org.springframework.session.data.redis.ReactiveRedisSessionRepository;
import org.springframework.session.data.redis.config.annotation.web.server.EnableRedisWebSession;

// The WebSession (security context and authorized client with the tokens)
// lives in Redis, so any gateway instance can serve the session.
@EnableRedisWebSession
@Configuration(proxyBeanMethods = false)
class SessionConfig {

    @Bean
    ReactiveSessionRepositoryCustomizer<ReactiveRedisSessionRepository> sessionIdleTimeout(
            @Value("${playground.session.idle-timeout}") Duration idleTimeout) {
        // Every request saves the session and pushes its Redis TTL out by this
        // much, so an idle session expires in Redis on its own.
        return (repository) -> repository.setDefaultMaxInactiveInterval(idleTimeout);
    }

    @Bean
    StableSessionSecurityContextRepository securityContextRepository(
            @Value("${playground.session.absolute-timeout}") Duration absoluteTimeout) {
        return new StableSessionSecurityContextRepository(Clock.systemUTC(), absoluteTimeout);
    }

    @Bean
    LettuceClientOptionsBuilderCustomizer rejectCommandsWhileDisconnected() {
        // By default Lettuce queues commands while it reconnects and they wait
        // for the command timeout. Rejecting them at once turns a Redis outage
        // into an immediate 503 (RedisUnavailableHandler).
        // publishOnScheduler: the request work after a reply (deserializing
        // the session, security, routing) runs off Lettuce's I/O thread, so
        // it cannot delay the next reply into a command timeout.
        return (options) -> options.disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)
            .publishOnScheduler(true);
    }
}
