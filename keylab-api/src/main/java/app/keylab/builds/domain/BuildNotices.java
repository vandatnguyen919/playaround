package app.keylab.builds.domain;

import org.jmolecules.architecture.hexagonal.SecondaryPort;

/**
 * Tells other modules what a stored change means for them (BuildPublished,
 * BuildWithdrawn), from the events the build recorded. Called after the build
 * is stored, in the same transaction.
 */
@SecondaryPort
public interface BuildNotices {

    void announce(Build build);
}
