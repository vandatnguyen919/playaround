package dev.playground.gateway;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.RouterFunctions;
import org.springframework.web.reactive.function.server.ServerResponse;

import static org.springframework.web.reactive.function.server.RequestPredicates.GET;

@Configuration(proxyBeanMethods = false)
class SpaConfig {

    /**
     * The SPA's client-side routes all load the same index.html; its hashed
     * assets come from the static resource handler (spring.web.resources).
     * Served by the gateway, so the HTML carries the CSP and other headers.
     */
    @Bean
    RouterFunction<ServerResponse> spaRoutes(ResourceLoader resources,
            @Value("${playground.spa-location}") String spaLocation) {
        Resource index = resources.getResource(spaLocation + "index.html");
        return RouterFunctions.route(GET("/").or(GET("/me")).or(GET("/admin")).or(GET("/forbidden")),
                (request) -> index.exists()
                        ? ServerResponse.ok().contentType(MediaType.TEXT_HTML).bodyValue(index)
                        : ServerResponse.notFound().build());
    }
}
