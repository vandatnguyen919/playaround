package dev.playground.gateway;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;

import reactor.core.publisher.Mono;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.web.server.OidcBackChannelServerLogoutHandler;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.oauth2.client.AuthorizationCodeReactiveOAuth2AuthorizedClientProvider;
import org.springframework.security.oauth2.client.DelegatingReactiveOAuth2AuthorizedClientProvider;
import org.springframework.security.oauth2.client.endpoint.OAuth2AuthorizationCodeGrantRequest;
import org.springframework.security.oauth2.client.endpoint.ReactiveOAuth2AccessTokenResponseClient;
import org.springframework.security.oauth2.client.endpoint.WebClientReactiveAuthorizationCodeTokenResponseClient;
import org.springframework.security.oauth2.client.oidc.authentication.OidcAuthorizationCodeReactiveAuthenticationManager;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcReactiveOAuth2UserService;
import org.springframework.security.oauth2.client.RefreshOidcUserReactiveOAuth2AuthorizationSuccessHandler;
import org.springframework.security.oauth2.client.RefreshTokenReactiveOAuth2AuthorizedClientProvider;
import org.springframework.security.oauth2.client.ReactiveOAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.oidc.server.session.InMemoryReactiveOidcSessionRegistry;
import org.springframework.security.oauth2.client.oidc.server.session.ReactiveOidcSessionRegistry;
import org.springframework.security.oauth2.client.oidc.web.server.logout.OidcClientInitiatedServerLogoutSuccessHandler;
import org.springframework.security.oauth2.client.registration.ReactiveClientRegistrationRepository;
import org.springframework.security.authentication.ReactiveAuthenticationManager;
import org.springframework.security.oauth2.client.web.DefaultReactiveOAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.web.server.DefaultServerOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.server.ServerOAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.client.web.server.WebSessionServerOAuth2AuthorizedClientRepository;
import org.springframework.security.core.authority.mapping.GrantedAuthoritiesMapper;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.security.web.server.ServerRedirectStrategy;
import org.springframework.security.web.server.authentication.HttpStatusServerEntryPoint;
import org.springframework.security.web.server.authentication.logout.DelegatingServerLogoutHandler;
import org.springframework.security.web.server.authentication.logout.SecurityContextServerLogoutHandler;
import org.springframework.security.web.server.authentication.logout.ServerLogoutSuccessHandler;
import org.springframework.security.web.server.authentication.logout.WebSessionServerLogoutHandler;
import org.springframework.security.web.server.csrf.CookieServerCsrfTokenRepository;
import org.springframework.web.server.ServerWebExchange;

@Configuration(proxyBeanMethods = false)
public class SecurityConfig {

    @Bean
    SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http,
            ReactiveClientRegistrationRepository clientRegistrations,
            ServerOAuth2AuthorizedClientRepository authorizedClients,
            ReactiveAuthenticationManager oidcAuthenticationManager) {
        // Keycloak enforces PKCE S256 for the gateway client, so always apply
        // it. The code_verifier travels in the authorization request attributes
        // and is sent back on the token request.
        DefaultServerOAuth2AuthorizationRequestResolver authorizationRequestResolver =
                new DefaultServerOAuth2AuthorizationRequestResolver(clientRegistrations);
        authorizationRequestResolver
                .setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());

        http
            .authorizeExchange((authorize) -> authorize
                .pathMatchers("/", "/favicon.ico", "/bff/csrf", "/actuator/health").permitAll()
                .pathMatchers("/oauth2/authorization/**", "/login/oauth2/code/**",
                        "/logout/connect/back-channel/**").permitAll()
                .pathMatchers("/bff/me").hasRole("user")
                .pathMatchers("/bff/admin").hasRole("admin")
                .anyExchange().authenticated())
            // Rotate the session id at login, not on token refresh saves, so
            // parallel requests do not lose the session cookie.
            .securityContextRepository(new StableSessionSecurityContextRepository())
            .oauth2Login((login) -> login
                .authenticationManager(oidcAuthenticationManager)
                .authorizationRequestResolver(authorizationRequestResolver)
                .authorizedClientRepository(authorizedClients))
            .exceptionHandling((exceptions) -> exceptions
                // Unauthenticated calls get 401, never a redirect to Keycloak:
                // the SPA drives login with a top-level navigation.
                .authenticationEntryPoint(new HttpStatusServerEntryPoint(HttpStatus.UNAUTHORIZED)))
            .logout((logout) -> logout
                .logoutHandler(new DelegatingServerLogoutHandler(new SecurityContextServerLogoutHandler(),
                        new WebSessionServerLogoutHandler()))
                .logoutSuccessHandler(oidcLogoutSuccessHandler(clientRegistrations)))
            .oidcLogout((oidc) -> oidc.backChannel(Customizer.withDefaults()))
            .csrf((csrf) -> csrf
                // Cookie to header CSRF: the raw token lands in the
                // XSRF-TOKEN cookie and Axios echoes it in the X-XSRF-TOKEN
                // header, so the SPA needs no CSRF code.
                .csrfTokenRepository(CookieServerCsrfTokenRepository.withHttpOnlyFalse())
                .csrfTokenRequestHandler(new SpaServerCsrfTokenRequestHandler()));
        return http.build();
    }

    @Bean
    GrantedAuthoritiesMapper realmRoleAuthoritiesMapper() {
        return new RealmRoleAuthoritiesMapper();
    }

    @Bean
    ReactiveOAuth2AccessTokenResponseClient<OAuth2AuthorizationCodeGrantRequest>
            authorizationCodeTokenResponseClient() {
        return new WebClientReactiveAuthorizationCodeTokenResponseClient();
    }

    @Bean
    ReactiveAuthenticationManager oidcAuthenticationManager(
            ReactiveOAuth2AccessTokenResponseClient<OAuth2AuthorizationCodeGrantRequest> tokenClient) {
        OidcAuthorizationCodeReactiveAuthenticationManager manager =
                new OidcAuthorizationCodeReactiveAuthenticationManager(
                        tokenClient, new OidcReactiveOAuth2UserService());
        manager.setAuthoritiesMapper(realmRoleAuthoritiesMapper());
        return manager;
    }

    @Bean
    ServerOAuth2AuthorizedClientRepository authorizedClientRepository() {
        // Access and refresh tokens live in the Redis-backed WebSession, so
        // they survive restarts and are shared by gateway instances.
        return new WebSessionServerOAuth2AuthorizedClientRepository();
    }

    @Bean
    ReactiveOAuth2AuthorizedClientManager authorizedClientManager(
            ReactiveClientRegistrationRepository clientRegistrations,
            ServerOAuth2AuthorizedClientRepository authorizedClients) {
        // Used by the TokenRelay filter to read (and refresh) the access token.
        DelegatingReactiveOAuth2AuthorizedClientProvider providers = new DelegatingReactiveOAuth2AuthorizedClientProvider(
                List.of(new AuthorizationCodeReactiveOAuth2AuthorizedClientProvider(),
                        new RefreshTokenReactiveOAuth2AuthorizedClientProvider()));
        DefaultReactiveOAuth2AuthorizedClientManager clientManager =
                new DefaultReactiveOAuth2AuthorizedClientManager(clientRegistrations, authorizedClients);
        clientManager.setAuthorizedClientProvider(providers);
        // A refresh also re-reads the ID token and saves the updated user. The
        // default handler saves it through a repository that changes the
        // session id, which logs out parallel requests on the old id.
        RefreshOidcUserReactiveOAuth2AuthorizationSuccessHandler successHandler =
                new RefreshOidcUserReactiveOAuth2AuthorizationSuccessHandler();
        successHandler.setServerSecurityContextRepository(new StableSessionSecurityContextRepository());
        clientManager.setAuthorizationSuccessHandler(successHandler);
        return clientManager;
    }

    @Bean
    ReactiveOidcSessionRegistry oidcSessionRegistry() {
        // Correlates Keycloak sessions with gateway sessions. In memory is
        // fine for one gateway instance at a time.
        return new InMemoryReactiveOidcSessionRegistry();
    }

    @Bean
    OidcBackChannelServerLogoutHandler oidcLogoutHandler(ReactiveOidcSessionRegistry sessionRegistry) {
        OidcBackChannelServerLogoutHandler logoutHandler = new OidcBackChannelServerLogoutHandler(sessionRegistry);
        // Spring Session names the session cookie SESSION, not JSESSIONID.
        logoutHandler.setSessionCookieName("SESSION");
        return logoutHandler;
    }

    private ServerLogoutSuccessHandler oidcLogoutSuccessHandler(
            ReactiveClientRegistrationRepository clientRegistrations) {
        // RP-initiated logout: the browser goes to Keycloak's end_session
        // endpoint and comes back to the application afterwards. The SPA calls
        // logout with XHR, which cannot follow the redirect chain across
        // origins, so hand it the logout URL to open as a top-level request.
        OidcClientInitiatedServerLogoutSuccessHandler logoutSuccessHandler =
                new OidcClientInitiatedServerLogoutSuccessHandler(clientRegistrations);
        logoutSuccessHandler.setPostLogoutRedirectUri("{baseUrl}/");
        logoutSuccessHandler.setRedirectStrategy(this::writeLogoutUrl);
        return logoutSuccessHandler;
    }

    private Mono<Void> writeLogoutUrl(ServerWebExchange exchange, URI location) {
        String escaped = location.toString().replace("\\", "\\\\").replace("\"", "\\\"");
        exchange.getResponse().setStatusCode(HttpStatus.OK);
        exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
        DataBuffer buffer = exchange.getResponse().bufferFactory()
                .wrap(("{\"logoutUrl\":\"" + escaped + "\"}").getBytes(StandardCharsets.UTF_8));
        return exchange.getResponse().writeWith(Mono.just(buffer));
    }
}
