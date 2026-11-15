package app.keylab.shared;

import java.util.UUID;

import org.springframework.security.oauth2.jwt.Jwt;

/**
 * A KeyLab user. The value is the Keycloak {@code sub}, so every module (and
 * every service split out later) names the same person the same way.
 */
public record UserId(UUID value) {

    public UserId {
        if (value == null) {
            throw new IllegalArgumentException("A user id needs a value");
        }
    }

    public static UserId of(String value) {
        return new UserId(UUID.fromString(value));
    }

    /** The caller of a request, from the relayed access token. */
    public static UserId of(Jwt jwt) {
        return of(jwt.getSubject());
    }

    @Override
    public String toString() {
        return value.toString();
    }
}
