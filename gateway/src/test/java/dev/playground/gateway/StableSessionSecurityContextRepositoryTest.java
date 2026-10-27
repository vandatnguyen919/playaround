package dev.playground.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.web.server.WebSession;

class StableSessionSecurityContextRepositoryTest {

    private final StableSessionSecurityContextRepository repository = new StableSessionSecurityContextRepository();

    private final MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/"));

    @Test
    void loginChangesTheSessionId() {
        String preLogin = sessionId();

        save(contextFor("alice"));

        assertThat(sessionId()).isNotEqualTo(preLogin);
    }

    @Test
    void sameUserSaveKeepsTheSessionId() {
        save(contextFor("alice"));
        String afterLogin = sessionId();

        // A token refresh saves a new context for the same user.
        save(contextFor("alice"));

        assertThat(sessionId()).isEqualTo(afterLogin);
    }

    @Test
    void differentUserChangesTheSessionId() {
        save(contextFor("alice"));
        String alice = sessionId();

        save(contextFor("bob"));

        assertThat(sessionId()).isNotEqualTo(alice);
    }

    @Test
    void clearingTheContextRemovesItFromTheSession() {
        save(contextFor("alice"));

        save(null);

        assertThat(this.repository.load(this.exchange).block()).isNull();
    }

    private void save(SecurityContext context) {
        this.repository.save(this.exchange, context).block();
    }

    private String sessionId() {
        WebSession session = this.exchange.getSession().block();
        session.start();
        return session.getId();
    }

    private static SecurityContext contextFor(String subject) {
        Instant now = Instant.now();
        OidcIdToken idToken = new OidcIdToken("token", now, now.plusSeconds(60), Map.of("sub", subject));
        DefaultOidcUser user = new DefaultOidcUser(List.of(), idToken);
        return new SecurityContextImpl(new OAuth2AuthenticationToken(user, List.of(), "gateway"));
    }
}
