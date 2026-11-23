package app.keylab.builds.application;

import java.time.Clock;
import java.util.UUID;

import app.keylab.builds.domain.Build;
import app.keylab.builds.domain.BuildRules;
import app.keylab.builds.domain.Builds;
import app.keylab.builds.domain.PartsCatalog;
import app.keylab.shared.Ids;

import org.jmolecules.architecture.hexagonal.PrimaryPort;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * BLD-02 (US-08): save a build from the builder. It starts private unless
 * asked public, at version 1, with the parts' sound kept for later.
 */
@PrimaryPort
@Service
public class SaveBuild {

    private final Builds builds;
    private final PartsCatalog catalog;
    private final Clock clock;

    @Autowired
    SaveBuild(Builds builds, PartsCatalog catalog) {
        this(builds, catalog, Clock.systemUTC());
    }

    SaveBuild(Builds builds, PartsCatalog catalog, Clock clock) {
        this.builds = builds;
        this.catalog = catalog;
        this.clock = clock;
    }

    /**
     * @return the new build's id
     * @throws app.keylab.builds.domain.InvalidBuild with every field to fix
     */
    @Transactional
    public UUID save(UUID owner, BuildInput input) {
        BuildRules.Checked checked = BuildRules.check(input.name(), input.visibility(), input.parts(), catalog,
                true);
        Build build = Build.create(Ids.uuidV7(), owner, input.name(), checked.visibility(), input.parts(),
                checked.review().keycaps(), checked.review().sound(), clock.instant());
        builds.add(build);
        return build.id();
    }
}
