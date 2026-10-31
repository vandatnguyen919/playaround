package dev.playground.gateway;

import java.util.Map;
import java.util.Set;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.env.Environment;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrations;
import org.springframework.security.oauth2.client.registration.InMemoryReactiveClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.ReactiveClientRegistrationRepository;
import org.springframework.web.client.RestClient;

/**
 * Production wiring for the gateway client when Keycloak's public URL is not
 * reachable from the gateway's network (compose, Kubernetes). Discovery is
 * read from the private URL (KEYCLOAK_DISCOVERY_URI, for example
 * http://keycloak:8080/realms/playground/.well-known/openid-configuration).
 * With KC_HOSTNAME_BACKCHANNEL_DYNAMIC, Keycloak answers there with the
 * public issuer, authorization and end session endpoints (the browser's) and
 * private token, JWKS and userinfo endpoints (the gateway's).
 *
 * Spring Boot's own discovery cannot do this: it requires the issuer to equal
 * the URL it fetched. Here the issuer must equal KEYCLOAK_ISSUER_URI instead,
 * and ID and logout tokens are checked against it as usual. Without
 * KEYCLOAK_DISCOVERY_URI (dev, tests) Spring Boot's discovery runs unchanged.
 */
@Configuration(proxyBeanMethods = false)
// Empty by default (application.yml), which must count as unset.
@ConditionalOnExpression("!'${playground.oidc.discovery-uri:}'.isEmpty()")
class KeycloakBackChannelConfig {

    @Bean
    ReactiveClientRegistrationRepository clientRegistrationRepository(
            @Value("${playground.oidc.discovery-uri}") String discoveryUri,
            @Value("${spring.security.oauth2.client.provider.keycloak.issuer-uri}") String issuerUri,
            @Value("${spring.security.oauth2.client.registration.gateway.client-id}") String clientId,
            @Value("${spring.security.oauth2.client.registration.gateway.client-secret}") String clientSecret,
            @Value("${spring.security.oauth2.client.registration.gateway.redirect-uri}") String redirectUri,
            Environment environment) {
        // A YAML list, which @Value cannot read.
        Set<String> scopes = Binder.get(environment)
                .bind("spring.security.oauth2.client.registration.gateway.scope", Bindable.setOf(String.class))
                .orElse(Set.of("openid"));
        Map<String, Object> metadata = RestClient.create().get().uri(discoveryUri).retrieve()
                .body(new ParameterizedTypeReference<Map<String, Object>>() { });
        return new InMemoryReactiveClientRegistrationRepository(
                registration(metadata, issuerUri, clientId, clientSecret, redirectUri, scopes));
    }

    static ClientRegistration registration(Map<String, Object> metadata, String issuerUri, String clientId,
            String clientSecret, String redirectUri, Set<String> scopes) {
        Object issuer = (metadata != null) ? metadata.get("issuer") : null;
        if (!issuerUri.equals(issuer)) {
            throw new IllegalStateException("Discovery issuer " + issuer + " does not match " + issuerUri
                    + ". Check KEYCLOAK_ISSUER_URI and Keycloak's KC_HOSTNAME.");
        }
        return ClientRegistrations.fromOidcConfiguration(metadata)
                .registrationId("gateway")
                .clientId(clientId)
                .clientSecret(clientSecret)
                .redirectUri(redirectUri)
                .scope(scopes)
                .build();
    }
}
