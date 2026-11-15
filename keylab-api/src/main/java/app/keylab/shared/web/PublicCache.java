package app.keylab.shared.web;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;

import app.keylab.shared.concurrency.ETags;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

import tools.jackson.databind.json.JsonMapper;

/**
 * Public, cacheable answers: the catalog and shared builds are sent with
 * {@code Cache-Control: public, max-age=300} and an {@code ETag} made from the
 * body, and a matching {@code If-None-Match} gets {@code 304} with no body
 * (api-design-v1.md, Conventions, Caching).
 */
@Component
public class PublicCache {

    public static final Duration MAX_AGE = Duration.ofSeconds(300);
    private static final CacheControl PUBLIC = CacheControl.maxAge(MAX_AGE).cachePublic();

    private final JsonMapper json;

    PublicCache(JsonMapper json) {
        this.json = json;
    }

    /** {@code body} as JSON, or 304 when the client already holds this exact body. */
    public ResponseEntity<String> ok(Object body, String ifNoneMatch) {
        String text = json.writeValueAsString(body);
        String etag = ETags.of(hash(text));
        if (matches(ifNoneMatch, etag)) {
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED).cacheControl(PUBLIC).eTag(etag).build();
        }
        return ResponseEntity.ok().cacheControl(PUBLIC).eTag(etag).contentType(MediaType.APPLICATION_JSON).body(text);
    }

    /** RFC 9110 weak comparison: W/"x" matches "x"; {@code *} matches anything. */
    static boolean matches(String ifNoneMatch, String etag) {
        if (ifNoneMatch == null || ifNoneMatch.isBlank()) {
            return false;
        }
        for (String candidate : ifNoneMatch.split(",")) {
            String tag = candidate.trim();
            if (tag.equals("*")) {
                return true;
            }
            if (tag.startsWith("W/")) {
                tag = tag.substring(2);
            }
            if (tag.equals(etag)) {
                return true;
            }
        }
        return false;
    }

    private static String hash(String text) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest, 0, 16);
        }
        catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
