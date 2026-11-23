package app.keylab.builds.application;

import java.time.Clock;
import java.util.UUID;

import app.keylab.builds.domain.Build;
import app.keylab.builds.domain.BuildNotFound;
import app.keylab.builds.domain.BuildNotices;
import app.keylab.builds.domain.Builds;

import org.jmolecules.architecture.hexagonal.PrimaryPort;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * BLD-05 (US-12): delete a build. The delete is soft, so the build is 404 on
 * every endpoint at once, its old link included; {@code BuildWithdrawn} lets
 * the profile clear a daily-driver pin on it. Order of answers: unknown or
 * someone else's build (404), then the precondition (400, 412).
 */
@PrimaryPort
@Service
public class DeleteBuild {

    private final Builds builds;
    private final BuildNotices notices;
    private final Clock clock;

    @Autowired
    DeleteBuild(Builds builds, BuildNotices notices) {
        this(builds, notices, Clock.systemUTC());
    }

    DeleteBuild(Builds builds, BuildNotices notices, Clock clock) {
        this.builds = builds;
        this.notices = notices;
        this.clock = clock;
    }

    /**
     * @throws BuildNotFound for an unknown, deleted or someone else's build
     * @throws app.keylab.builds.domain.BuildChangedMeanwhile when another change got in first
     */
    @Transactional
    public void delete(UUID caller, UUID id, EditBuild.VersionCheck versionCheck) {
        Build build = builds.load(id).filter((b) -> b.isOwnedBy(caller)).orElseThrow(BuildNotFound::new);
        versionCheck.check(build.version());
        build.delete(clock.instant());
        builds.save(build);
        notices.announce(build);
    }
}
