package app.keylab.builds;

import java.util.UUID;

/**
 * A build left the public: it went private, or it was deleted (US-12).
 * {@code community} clears a daily-driver pin on it (US-26). A deleted build
 * is announced whatever its visibility was, so a listener never keeps a
 * reference to a build that is gone.
 *
 * @param buildId the build
 * @param ownerId its owner, the Keycloak {@code sub}
 * @param reason why it left
 */
public record BuildWithdrawn(UUID buildId, UUID ownerId, Reason reason) {

    public enum Reason {
        PRIVATE,
        DELETED
    }
}
