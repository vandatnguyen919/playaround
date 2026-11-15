package app.keylab.testing;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.sun.net.httpserver.HttpServer;

import org.springframework.test.context.DynamicPropertyRegistry;

/**
 * A JWKS endpoint the tests own, so they can mint tokens Keycloak never
 * would (wrong audience, expired, tampered) and the API still runs its real
 * JWT checks. One server for the run, so every test shares one Spring context.
 */
public final class StubJwks {

    public static final RSAKey KEY = TestTokens.newKey("test-key");
    /** Same key id as the real one: the API must check the signature, not just the id. */
    public static final RSAKey OTHER_KEY = TestTokens.newKey("test-key");

    private static final HttpServer SERVER = start();
    public static final String ISSUER = "http://localhost:" + SERVER.getAddress().getPort() + "/realms/playground";

    private StubJwks() {
    }

    public static void register(DynamicPropertyRegistry registry) {
        registry.add("KEYCLOAK_ISSUER_URI", () -> ISSUER);
        registry.add("KEYCLOAK_JWK_SET_URI", () -> ISSUER + "/protocol/openid-connect/certs");
    }

    /** Claims of a valid token for keylab-api with these realm roles. */
    public static JWTClaimsSet.Builder claims(String... roles) {
        Instant now = Instant.now();
        return TestTokens.claims(ISSUER, "user@example.com", List.of(roles), now, now.plus(Duration.ofMinutes(5)));
    }

    /** A valid, signed token for keylab-api with these realm roles. */
    public static String token(String... roles) {
        return TestTokens.sign(KEY, claims(roles).build());
    }

    private static HttpServer start() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
            byte[] body = new JWKSet(KEY.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
            server.createContext("/realms/playground/protocol/openid-connect/certs", (exchange) -> {
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
                exchange.close();
            });
            server.setExecutor(null);
            server.start();
            return server;
        }
        catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
