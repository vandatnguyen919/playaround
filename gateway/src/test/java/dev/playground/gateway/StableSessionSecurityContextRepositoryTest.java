package dev.playground.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
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

    private static final Duration ABSOLUTE_TIMEOUT = Duration.ofHours(10);

    private final MutableClock clock = new MutableClock(Instant.parse("2026-10-28T08:00:00Z"));

    private final StableSessionSecurityContextRepository repository =
            new StableSessionSecurityContextRepository(this.clock, ABSOLUTE_TIMEOUT);

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

    @Test
    void sessionWorksUntilTheAbsoluteTimeout() {
        save(contextFor("alice"));

        this.clock.advance(ABSOLUTE_TIMEOUT.minusSeconds(1));

        assertThat(this.repository.load(this.exchange).block()).isNotNull();
    }

    @Test
    void absoluteTimeoutEndsAnActiveSession() {
        save(contextFor("alice"));
        WebSession session = this.exchange.getSession().block();

        this.clock.advance(ABSOLUTE_TIMEOUT);

        assertThat(this.repository.load(this.exchange).block()).isNull();
        assertThat(session.getAttributes()).isEmpty();
    }

    @Test
    void tokenRefreshSaveDoesNotExtendTheAbsoluteTimeout() {
        save(contextFor("alice"));
        this.clock.advance(Duration.ofHours(9));

        // Same user: a refresh, not a new sign-in.
        save(contextFor("alice"));
        this.clock.advance(Duration.ofHours(1));

        assertThat(this.repository.load(this.exchange).block()).isNull();
    }

    @Test
    void newSignInRestartsTheAbsoluteTimeout() {
        save(contextFor("alice"));
        this.clock.advance(Duration.ofHours(9));

        save(contextFor("bob"));
        this.clock.advance(Duration.ofHours(9));

        assertThat(this.repository.load(this.exchange).block()).isNotNull();
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

    private static final class MutableClock extends Clock {

        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void advance(Duration duration) {
            this.now = this.now.plus(duration);
        }

        @Override
        public Instant instant() {
            return this.now;
        }

        @Override
        public java.time.ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }
    }
}
