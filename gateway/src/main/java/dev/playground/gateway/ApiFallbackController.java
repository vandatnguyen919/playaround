package dev.playground.gateway;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeoutException;

import io.github.resilience4j.circuitbreaker.CallNotPermittedException;

import org.springframework.cloud.gateway.support.ServerWebExchangeUtils;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;

/**
 * Answer of the API and keylab-api routes when the CircuitBreaker filter gives up: the API
 * was too slow (time limiter), the circuit is open after repeated failures,
 * or the API failed with a 5xx or could not be reached.
 */
@RestController
class ApiFallbackController {

    @RequestMapping("/fallback/api")
    ResponseEntity<Map<String, String>> fallback(ServerWebExchange exchange) {
        Throwable cause = exchange.getAttribute(ServerWebExchangeUtils.CIRCUITBREAKER_EXECUTION_EXCEPTION_ATTR);
        if (cause instanceof TimeoutException) {
            return error(HttpStatus.GATEWAY_TIMEOUT, "api_timeout", "The service took too long to answer. Please try again.");
        }
        if (cause instanceof CallNotPermittedException) {
            // Open circuit: the API is not called until the wait in open state ends.
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .header(HttpHeaders.RETRY_AFTER, "15")
                    .body(body("api_unavailable", "The service is temporarily unavailable. Please try again shortly."));
        }
        return error(HttpStatus.BAD_GATEWAY, "api_error", "The service could not handle the request. Please try again.");
    }

    /**
     * Same three cases for keylab-api, in its own error format (RFC 9457
     * problem+json with a stable code), so the KeyLab client reads one shape.
     */
    @RequestMapping("/fallback/keylab")
    ResponseEntity<Map<String, Object>> keylabFallback(ServerWebExchange exchange) {
        Throwable cause = exchange.getAttribute(ServerWebExchangeUtils.CIRCUITBREAKER_EXECUTION_EXCEPTION_ATTR);
        if (cause instanceof TimeoutException) {
            return problem(HttpStatus.GATEWAY_TIMEOUT, "api_timeout", "The service took too long to answer")
                    .build();
        }
        if (cause instanceof CallNotPermittedException) {
            return problem(HttpStatus.SERVICE_UNAVAILABLE, "api_unavailable", "The service is temporarily unavailable")
                    .header(HttpHeaders.RETRY_AFTER, "15")
                    .build();
        }
        return problem(HttpStatus.BAD_GATEWAY, "api_error", "The service could not handle the request").build();
    }

    private static ResponseEntity.BodyBuilder problemStatus(HttpStatus status) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON);
    }

    private static ProblemResponse problem(HttpStatus status, String code, String title) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", "https://keylab.app/problems/" + code.replace('_', '-'));
        body.put("title", title);
        body.put("status", status.value());
        body.put("code", code);
        body.put("detail", "Please try again shortly.");
        return new ProblemResponse(problemStatus(status), body);
    }

    private record ProblemResponse(ResponseEntity.BodyBuilder builder, Map<String, Object> body) {

        ProblemResponse header(String name, String value) {
            this.builder.header(name, value);
            return this;
        }

        ResponseEntity<Map<String, Object>> build() {
            return this.builder.body(this.body);
        }
    }

    private static ResponseEntity<Map<String, String>> error(HttpStatus status, String error, String message) {
        return ResponseEntity.status(status).body(body(error, message));
    }

    private static Map<String, String> body(String error, String message) {
        return Map.of("error", error, "message", message);
    }
}
