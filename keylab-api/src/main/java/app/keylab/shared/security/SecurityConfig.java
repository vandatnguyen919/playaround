package app.keylab.shared.security;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.servlet.HandlerExceptionResolver;

/**
 * keylab-api is an OAuth2 resource server. It never sees the browser: the
 * gateway relays the signed-in user's access token as a bearer header, and
 * guests arrive with no token at all. Issuer, keys and the required audience
 * (keylab-api) are in application.yml.
 *
 * Closed by default: a new endpoint needs a token unless a rule here opens
 * it. Stories with public GETs (catalog, shared builds, public profiles,
 * plans) add their paths to the permitAll list.
 */
@Configuration(proxyBeanMethods = false)
@EnableMethodSecurity
class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http,
            @Qualifier("handlerExceptionResolver") HandlerExceptionResolver exceptionResolver) throws Exception {
        ProblemSecurityHandlers problems = new ProblemSecurityHandlers(exceptionResolver);
        http
            .authorizeHttpRequests((authorize) -> authorize
                .requestMatchers("/actuator/health").permitAll()
                .requestMatchers(HttpMethod.GET, "/v1/health").permitAll()
                // The public catalog (CAT): published items only, guests welcome.
                .requestMatchers(HttpMethod.GET, "/v1/switches", "/v1/switches/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/v1/keycap-sets", "/v1/keycap-sets/*", "/v1/mods",
                        "/v1/case-options").permitAll()
                // The sound recipe (BLD-10): guests hear any parts mix.
                .requestMatchers(HttpMethod.GET, "/v1/sound-recipe").permitAll()
                // A build's link (BLD-03): public builds for guests; the controller hides private and deleted ones.
                .requestMatchers(HttpMethod.GET, "/v1/builds/*").permitAll()
                // Content-addressed sound and photo files (US-38): public, like a CDN.
                .requestMatchers(HttpMethod.GET, "/v1/assets/**").permitAll()
                // Presigned upload URLs (ADM-04): the signature in the URL is the permission.
                .requestMatchers(HttpMethod.PUT, "/v1/uploads/*").permitAll()
                // Each admin endpoint names its lowest role; none works below viewer.
                .requestMatchers("/v1/admin/**").hasRole(Roles.VIEWER)
                .anyRequest().authenticated())
            // No browser, no cookies: nothing for CSRF to protect and no session to keep.
            .csrf((csrf) -> csrf.disable())
            .sessionManagement((session) -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .oauth2ResourceServer((oauth2) -> oauth2
                .authenticationEntryPoint(problems)
                .accessDeniedHandler(problems)
                .jwt((jwt) -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter())))
            .exceptionHandling((exceptions) -> exceptions
                .authenticationEntryPoint(problems)
                .accessDeniedHandler(problems));
        return http.build();
    }

    private JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(new RealmRoleAuthoritiesConverter());
        return converter;
    }
}
