package app.keylab.builds;

import java.util.UUID;

/**
 * A build became public, was saved public, or a public build saved new parts
 * (US-08, US-12). {@code community} builds its activity timeline from it.
 *
 * @param buildId the build
 * @param ownerId its owner, the Keycloak {@code sub}
 * @param versionNo the build's current version
 */
public record BuildPublished(UUID buildId, UUID ownerId, int versionNo) {
}
