package dev.playground.gateway;

import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.security.oauth2.client.oidc.authentication.logout.LogoutTokenClaimNames;
import org.springframework.security.oauth2.client.oidc.authentication.logout.OidcLogoutToken;
import org.springframework.security.oauth2.client.oidc.server.session.ReactiveOidcSessionRegistry;
import org.springframework.security.oauth2.client.oidc.session.OidcSessionInformation;
import org.springframework.security.oauth2.core.oidc.IdTokenClaimNames;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

/**
 * Keeps the map from Keycloak sessions to gateway sessions in Redis, next to
 * the sessions themselves.
 * <p>
 * Back-channel logout looks a logout token up here to find which gateway
 * session to end. The in-memory registry forgets every entry when the gateway
 * restarts, while the sessions live on in Redis, so a logout at Keycloak would
 * then leave the session alive. Storing the entries in Redis also lets any
 * gateway instance handle the back-channel call.
 * <p>
 * Only what logout needs is stored: issuer, audience, subject, Keycloak
 * session id ({@code sid}), and the headers (CSRF) that the logout handler
 * replays. No tokens.
 */
final class RedisReactiveOidcSessionRegistry implements ReactiveOidcSessionRegistry {

    private static final String PREFIX = "playground:oidc:";

    // Keycloak's default SSO max lifespan. An older entry cannot match a live
    // Keycloak session, so letting it expire loses nothing.
    private static final Duration TTL = Duration.ofHours(10);

    private static final String HEADER = "h:";

    private final ReactiveStringRedisTemplate redis;

    RedisReactiveOidcSessionRegistry(ReactiveStringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public Mono<Void> saveSessionInformation(OidcSessionInformation info) {
        OidcUser user = info.getPrincipal();
        String issuer = String.valueOf(user.getIssuer());
        String sid = user.getClaimAsString(LogoutTokenClaimNames.SID);
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("iss", issuer);
        fields.put("sub", user.getSubject());
        fields.put("aud", String.join(" ", user.getAudience()));
        if (sid != null) {
            fields.put("sid", sid);
        }
        info.getAuthorities().forEach((name, value) -> fields.put(HEADER + name, value));

        String key = sessionKey(info.getSessionId());
        Mono<Void> session = this.redis.opsForHash().putAll(key, fields).then(this.redis.expire(key, TTL)).then();
        Mono<Void> bySubject = index(subjectKey(issuer, user.getSubject()), info.getSessionId());
        Mono<Void> bySid = (sid != null) ? index(sidKey(issuer, sid), info.getSessionId()) : Mono.empty();
        return session.then(bySubject).then(bySid);
    }

    @Override
    public Mono<OidcSessionInformation> removeSessionInformation(String clientSessionId) {
        String key = sessionKey(clientSessionId);
        return this.redis.<String, String>opsForHash().entries(key)
            .collectMap(Map.Entry::getKey, Map.Entry::getValue)
            .filter((fields) -> !fields.isEmpty())
            .flatMap((fields) -> {
                String issuer = fields.get("iss");
                Mono<Long> unindex = this.redis.opsForSet().remove(subjectKey(issuer, fields.get("sub")), clientSessionId);
                if (fields.containsKey("sid")) {
                    unindex = unindex.then(this.redis.opsForSet().remove(sidKey(issuer, fields.get("sid")), clientSessionId));
                }
                return this.redis.delete(key).then(unindex).thenReturn(toInformation(clientSessionId, fields));
            });
    }

    @Override
    public Flux<OidcSessionInformation> removeSessionInformation(OidcLogoutToken token) {
        // Same matching as the in-memory registry: by sid when the token has
        // one, otherwise by subject; issuer and audience must match too.
        String issuer = token.getIssuer().toString();
        String sid = token.getSessionId();
        String indexKey = (sid != null) ? sidKey(issuer, sid) : subjectKey(issuer, token.getSubject());
        List<String> audience = token.getAudience();
        return this.redis.opsForSet().members(indexKey)
            .concatMap((clientSessionId) -> this.redis.<String, String>opsForHash().entries(sessionKey(clientSessionId))
                .collectMap(Map.Entry::getKey, Map.Entry::getValue)
                .filter((fields) -> issuer.equals(fields.get("iss"))
                        && !Collections.disjoint(audience, Arrays.asList(fields.getOrDefault("aud", "").split(" "))))
                .flatMap((fields) -> removeSessionInformation(clientSessionId)));
    }

    private Mono<Void> index(String key, String clientSessionId) {
        return this.redis.opsForSet().add(key, clientSessionId).then(this.redis.expire(key, TTL)).then();
    }

    // The logout handler reads the session id and headers; the principal only
    // has to carry the claims the matching uses.
    private static OidcSessionInformation toInformation(String clientSessionId, Map<String, String> fields) {
        Map<String, Object> claims = new HashMap<>();
        claims.put(IdTokenClaimNames.ISS, fields.get("iss"));
        claims.put(IdTokenClaimNames.SUB, fields.get("sub"));
        claims.put(IdTokenClaimNames.AUD, Arrays.asList(fields.getOrDefault("aud", "").split(" ")));
        if (fields.containsKey("sid")) {
            claims.put(LogoutTokenClaimNames.SID, fields.get("sid"));
        }
        Instant now = Instant.now();
        OidcIdToken idToken = new OidcIdToken("redacted", now, now.plus(TTL), claims);
        Map<String, String> headers = new LinkedHashMap<>();
        fields.forEach((name, value) -> {
            if (name.startsWith(HEADER)) {
                headers.put(name.substring(HEADER.length()), value);
            }
        });
        return new OidcSessionInformation(clientSessionId, headers, new DefaultOidcUser(List.of(), idToken));
    }

    private static String sessionKey(String clientSessionId) {
        return PREFIX + "session:" + clientSessionId;
    }

    private static String sidKey(String issuer, String sid) {
        return PREFIX + "sid:" + issuer + ":" + sid;
    }

    private static String subjectKey(String issuer, String subject) {
        return PREFIX + "sub:" + issuer + ":" + subject;
    }
}
