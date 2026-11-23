package app.keylab.builds.application;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import app.keylab.builds.domain.Build;
import app.keylab.builds.domain.BuildRules;
import app.keylab.builds.domain.BuildNotFound;
import app.keylab.builds.domain.Builds;
import app.keylab.builds.domain.PartsCatalog;

import org.jmolecules.architecture.hexagonal.PrimaryPort;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * BLD-04 (US-08 rename; US-12 visibility): change a build's name, parts or
 * visibility. The caller brings the precondition check and the patch as
 * functions, because both are about the request (If-Match, JSON Merge Patch);
 * this use case runs them against the build it loaded, in the order the API
 * answers: unknown or someone else's build (404), then the precondition
 * (400, 412), then the fields (422).
 */
@PrimaryPort
@Service
public class EditBuild {

    /** Checks the request was made against this row version, else throws. */
    @PrimaryPort
    @FunctionalInterface
    public interface VersionCheck {
        void check(long currentVersion);
    }

    /** Turns the build as it is into the build as the member wants it. */
    @PrimaryPort
    @FunctionalInterface
    public interface Patch {
        BuildInput apply(BuildInput current);
    }

    private final Builds builds;
    private final PartsCatalog catalog;
    private final Clock clock;

    @Autowired
    EditBuild(Builds builds, PartsCatalog catalog) {
        this(builds, catalog, Clock.systemUTC());
    }

    EditBuild(Builds builds, PartsCatalog catalog, Clock clock) {
        this.builds = builds;
        this.catalog = catalog;
        this.clock = clock;
    }

    /**
     * @throws BuildNotFound for an unknown, deleted or someone else's build
     * @throws app.keylab.builds.domain.InvalidBuild with every field to fix
     * @throws app.keylab.builds.domain.BuildChangedMeanwhile when another change got in first
     */
    @Transactional
    public void edit(UUID caller, UUID id, VersionCheck versionCheck, Patch patch) {
        Build build = builds.load(id).filter((b) -> b.isOwnedBy(caller)).orElseThrow(BuildNotFound::new);
        versionCheck.check(build.version());
        BuildInput current = new BuildInput(build.name(), build.visibility().wire(), build.current().parts());
        BuildInput wanted = patch.apply(current);
        // A patch that removes visibility (null) keeps it as it is.
        if (wanted.visibility() == null) {
            wanted = new BuildInput(wanted.name(), current.visibility(), wanted.parts());
        }
        boolean newParts = !wanted.parts().equals(current.parts());
        BuildRules.Checked checked = BuildRules.check(wanted.name(), wanted.visibility(), wanted.parts(),
                catalog, newParts);
        Instant now = clock.instant();
        build.rename(wanted.name(), now);
        build.changeVisibility(checked.visibility(), now);
        if (newParts) {
            build.changeParts(wanted.parts(), checked.review().keycaps(), checked.review().sound(), now);
        }
        if (!build.events().isEmpty()) {
            builds.save(build);
        }
    }
}
