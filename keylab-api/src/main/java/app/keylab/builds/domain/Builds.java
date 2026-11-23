package app.keylab.builds.domain;

import java.util.Optional;
import java.util.UUID;

import org.jmolecules.architecture.hexagonal.SecondaryPort;

/** Outbound port: where {@link Build} aggregates are kept ({@code builds.builds} and its versions). */
@SecondaryPort
public interface Builds {

    /** A build that is not deleted, whoever owns it. */
    Optional<Build> load(UUID id);

    /** Writes a new build with its first version. */
    void add(Build build);

    /**
     * Writes the changes the build recorded since it was loaded, only while it
     * is still at the version it was loaded at.
     *
     * @throws BuildChangedMeanwhile when another change got in first
     */
    void save(Build build);
}
