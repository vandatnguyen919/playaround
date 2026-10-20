package dev.playground.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.session.data.redis.config.annotation.web.server.EnableRedisWebSession;

// The WebSession (security context and authorized client with the tokens)
// lives in Redis, so any gateway instance can serve the session.
@EnableRedisWebSession
@SpringBootApplication
public class GatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}
