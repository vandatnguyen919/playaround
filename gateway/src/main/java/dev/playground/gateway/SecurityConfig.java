package dev.playground.gateway;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

import reactor.core.publisher.Mono;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
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
import org.springframework.security.web.server.header.ReferrerPolicyServerHttpHeadersWriter.ReferrerPolicy;
import org.springframework.security.web.server.header.XFrameOptionsServerHttpHeadersWriter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsConfigurationSource;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;
import org.springframework.web.server.ServerWebExchange;

@Configuration(proxyBeanMethods = false)
public class SecurityConfig {

    /**
     * CSP for the SPA (the Vite build: one module script and one stylesheet
     * under /assets, no inline code) and for every other gateway response.
     * Everything comes from this origin; XHR goes only to the gateway; Keycloak
     * is reached by top-level navigation, which CSP does not restrict. No page
     * may frame the app.
     */
    static final String CONTENT_SECURITY_POLICY = String.join("; ",
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self'",
            "img-src 'self'",
            "font-src 'self'",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'");

    @Bean
    SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http,
            ReactiveClientRegistrationRepository clientRegistrations,
            ServerOAuth2AuthorizedClientRepository authorizedClients,
            ReactiveAuthenticationManager oidcAuthenticationManager,
            StableSessionSecurityContextRepository securityContextRepository,
            @Value("${playground.app-url}") String appUrl,
            @Value("${server.reactive.session.cookie.secure:false}") boolean secureCookies) {
        // Keycloak enforces PKCE S256 for the gateway client, so always apply
        // it. The code_verifier travels in the authorization request attributes
        // and is sent back on the token request.
        DefaultServerOAuth2AuthorizationRequestResolver authorizationRequestResolver =
                new DefaultServerOAuth2AuthorizationRequestResolver(clientRegistrations);
        authorizationRequestResolver
                .setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());

        // Same flags as the SESSION cookie (application.yml), minus HttpOnly:
        // the SPA must read this one.
        CookieServerCsrfTokenRepository csrfTokenRepository = CookieServerCsrfTokenRepository.withHttpOnlyFalse();
        csrfTokenRepository.setCookieCustomizer((cookie) -> cookie.sameSite("Lax").secure(secureCookies));

        http
            .authorizeExchange((authorize) -> authorize
                // The SPA shell and its assets are public; its data is not.
                .pathMatchers("/", "/me", "/admin", "/forbidden", "/index.html", "/assets/**",
                        "/favicon.ico", "/favicon.svg", "/bff/csrf").permitAll()
                // Only on the management port (application.yml).
                .pathMatchers("/actuator/health/**", "/actuator/info").permitAll()
                .pathMatchers("/oauth2/authorization/**", "/login/oauth2/code/**",
                        "/logout/connect/back-channel/**").permitAll()
                .pathMatchers("/bff/me").hasRole("user")
                .pathMatchers("/bff/admin").hasRole("admin")
                .anyExchange().authenticated())
            // Rotate the session id at login, not on token refresh saves, so
            // parallel requests do not lose the session cookie.
            // It also ends sessions at the absolute timeout.
            .securityContextRepository(securityContextRepository)
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
                .csrfTokenRepository(csrfTokenRepository)
                .csrfTokenRequestHandler(new SpaServerCsrfTokenRequestHandler()))
            .headers((headers) -> headers
                // nosniff and no-store Cache-Control are on by default.
                .contentSecurityPolicy((csp) -> csp.policyDirectives(CONTENT_SECURITY_POLICY))
                .frameOptions((frame) -> frame.mode(XFrameOptionsServerHttpHeadersWriter.Mode.DENY))
                .referrerPolicy((referrer) -> referrer.policy(ReferrerPolicy.SAME_ORIGIN))
                // Written on https requests only, as the spec requires. Behind
                // Traefik that needs FORWARD_HEADERS_STRATEGY=native.
                .hsts((hsts) -> hsts.maxAge(Duration.ofDays(365)).includeSubdomains(true)))
            .cors((cors) -> cors.configurationSource(corsConfigurationSource(appUrl)));
        return http.build();
    }

    /**
     * The SPA is same origin, so it never needs CORS. Any other origin is
     * refused (403), preflight or not. The app's own origin is listed so a
     * request still passes if the scheme or host the gateway sees differs
     * from what the browser used (for example TLS ending at a proxy).
     */
    private static CorsConfigurationSource corsConfigurationSource(String appUrl) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of(appUrl));
        config.setAllowedMethods(List.of("GET", "POST"));
        config.setAllowedHeaders(List.of("Content-Type", "X-XSRF-TOKEN"));
        config.setAllowCredentials(true);
        config.setMaxAge(Duration.ofHours(1));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
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
            ServerOAuth2AuthorizedClientRepository authorizedClients,
            StableSessionSecurityContextRepository securityContextRepository) {
        // Used by the TokenRelay filter to read (and refresh) the access token.
        // A refresh also re-reads the ID token and saves the updated user. The
        // refresh token provider's own handler saves it through the stock
        // repository, which changes the session id on every refresh and logs
        // out parallel requests still on the old id. Give it ours. This must
        // sit on the provider: the manager's success handler is what stores
        // the refreshed tokens in the session, so it keeps its default.
        RefreshOidcUserReactiveOAuth2AuthorizationSuccessHandler oidcUserRefresh =
                new RefreshOidcUserReactiveOAuth2AuthorizationSuccessHandler();
        oidcUserRefresh.setServerSecurityContextRepository(securityContextRepository);
        RefreshTokenReactiveOAuth2AuthorizedClientProvider refreshTokens =
                new RefreshTokenReactiveOAuth2AuthorizedClientProvider();
        refreshTokens.setAuthorizationSuccessHandler(oidcUserRefresh);
        DelegatingReactiveOAuth2AuthorizedClientProvider providers = new DelegatingReactiveOAuth2AuthorizedClientProvider(
                List.of(new AuthorizationCodeReactiveOAuth2AuthorizedClientProvider(), refreshTokens));
        DefaultReactiveOAuth2AuthorizedClientManager clientManager =
                new DefaultReactiveOAuth2AuthorizedClientManager(clientRegistrations, authorizedClients);
        clientManager.setAuthorizedClientProvider(providers);
        return clientManager;
    }

    @Bean
    ReactiveOidcSessionRegistry oidcSessionRegistry(ReactiveStringRedisTemplate redis) {
        // Correlates Keycloak sessions with gateway sessions. In Redis, like
        // the sessions, so back-channel logout still finds them after a
        // gateway restart and on any instance.
        return new RedisReactiveOidcSessionRegistry(redis);
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
