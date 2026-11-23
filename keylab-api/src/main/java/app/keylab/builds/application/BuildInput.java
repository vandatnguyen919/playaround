package app.keylab.builds.application;

import app.keylab.builds.domain.Parts;

import org.jmolecules.architecture.hexagonal.PrimaryPort;

/**
 * A build as the member sends it (BuildInput in openapi-v1.yaml), before any
 * rule is checked.
 *
 * @param visibility "private", "public", or null for the default
 */
@PrimaryPort
public record BuildInput(String name, String visibility, Parts parts) {
}
