package dev.playground.gateway;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.List;

import io.lettuce.core.RedisException;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import reactor.core.publisher.Mono;

import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.RedisSystemException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebExceptionHandler;

/**
 * Turns a Redis outage into a clear 503 instead of a generic 500.
 * <p>
 * Every signed-in request reads its session from Redis, and login writes one,
 * so without Redis nobody can sign in or use the app. Page loads get a short
 * HTML page, XHR calls from the SPA get JSON it can show. Both say to try
 * again soon; nothing about Redis leaks to the user. Runs before Boot's
 * default error handler (order -1).
 */
@Component
@Order(-2)
class RedisUnavailableHandler implements WebExceptionHandler {

    private static final Log logger = LogFactory.getLog(RedisUnavailableHandler.class);

    static final String MESSAGE = "Sign-in is temporarily unavailable. Please try again in a minute.";

    private static final String RETRY_AFTER_SECONDS = "30";

    // Inline, so the page needs no second request (which would also need
    // the session). Allowed by its hash in the page's own CSP below.
    private static final String STYLE = "body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;"
            + "color:#18181b;background:#f4f4f5}main{max-width:28rem;margin:12vh auto 0;padding:2rem;background:#fff;"
            + "border:1px solid #e4e4e7;border-radius:1rem}h1{font-size:1.25rem;margin:0 0 .75rem}"
            + "p{line-height:1.5;margin:0 0 1rem;color:#3f3f46}a{display:inline-block;padding:.6rem 1rem;"
            + "border-radius:.5rem;background:#18181b;color:#fff;text-decoration:none}";

    /** Stricter than the app's CSP: no scripts at all, only this one style. */
    static final String PAGE_CSP = "default-src 'none'; style-src '" + sha256(STYLE)
            + "'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

    private static final String PAGE = """
            <!doctype html>
            <html lang="en">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Temporarily unavailable</title>
            <style>%s</style>
            </head>
            <body>
            <main>
            <h1>We'll be right back</h1>
            <p>%s</p>
            <p>If you were signed in, you may need to sign in again afterwards.</p>
            <a href="/">Try again</a>
            </main>
            </body>
            </html>
            """.formatted(STYLE, MESSAGE);

    private static final String JSON = "{\"error\":\"session_store_unavailable\",\"message\":\"" + MESSAGE + "\"}";

    @Override
    public Mono<Void> handle(ServerWebExchange exchange, Throwable ex) {
        ServerHttpResponse response = exchange.getResponse();
        if (!isRedisFailure(ex) || response.isCommitted()) {
            return Mono.error(ex);
        }
        // One line per request, no stack trace: an outage floods the log.
        logger.warn("Redis unavailable, answering 503 for " + exchange.getRequest().getPath() + ": " + ex);
        boolean page = wantsHtml(exchange);
        byte[] body = (page ? PAGE : JSON).getBytes(StandardCharsets.UTF_8);
        Mono<Void> write = Mono.defer(() -> {
            response.setStatusCode(HttpStatus.SERVICE_UNAVAILABLE);
            HttpHeaders headers = response.getHeaders();
            headers.set(HttpHeaders.RETRY_AFTER, RETRY_AFTER_SECONDS);
            headers.setCacheControl("no-store");
            headers.setContentType(page ? new MediaType(MediaType.TEXT_HTML, StandardCharsets.UTF_8)
                    : MediaType.APPLICATION_JSON);
            if (page) {
                // Set first, so Spring Security's header writer leaves it.
                headers.set("Content-Security-Policy", PAGE_CSP);
            }
            // A session created by this request was never saved; do not
            // hand the browser a cookie for it.
            response.getCookies().remove("SESSION");
            return response.writeWith(Mono.fromSupplier(() -> response.bufferFactory().wrap(body)));
        });
        // Committing runs the session save once more, which fails the same
        // way. A second write skips the failed commit actions and goes out.
        return write.onErrorResume(RedisUnavailableHandler::isRedisFailure, (failure) -> write);
    }

    static boolean isRedisFailure(Throwable ex) {
        for (Throwable t = ex; t != null; t = t.getCause()) {
            if (t instanceof DataAccessResourceFailureException || t instanceof QueryTimeoutException
                    || t instanceof RedisSystemException || t instanceof RedisException) {
                return true;
            }
        }
        return false;
    }

    private static String sha256(String text) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            return "sha256-" + Base64.getEncoder().encodeToString(digest);
        }
        catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    // A browser navigation asks for text/html first; Axios asks for JSON.
    private static boolean wantsHtml(ServerWebExchange exchange) {
        List<MediaType> accept = exchange.getRequest().getHeaders().getAccept();
        return !accept.isEmpty() && accept.getFirst().isCompatibleWith(MediaType.TEXT_HTML);
    }
}
