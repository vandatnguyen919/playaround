package app.keylab.builds.adapter.out.events;

import app.keylab.builds.BuildPublished;
import app.keylab.builds.BuildWithdrawn;
import app.keylab.builds.domain.Build;
import app.keylab.builds.domain.BuildEvent;
import app.keylab.builds.domain.BuildNotices;
import app.keylab.builds.domain.Visibility;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * Turns what a build recorded into the module's public events, at most one
 * per change: a delete is {@link BuildWithdrawn} (DELETED); going private is
 * {@link BuildWithdrawn} (PRIVATE); going public, a new public build, or new
 * parts on a public build is {@link BuildPublished}. A rename alone announces
 * nothing.
 */
@Component
class SpringBuildNotices implements BuildNotices {

    private final ApplicationEventPublisher events;

    SpringBuildNotices(ApplicationEventPublisher events) {
        this.events = events;
    }

    @Override
    public void announce(Build build) {
        boolean deleted = false;
        boolean wentPrivate = false;
        boolean published = false;
        for (BuildEvent event : build.events()) {
            switch (event) {
                case BuildEvent.Deleted d -> deleted = true;
                case BuildEvent.VisibilityChanged v -> {
                    wentPrivate = v.visibility() == Visibility.PRIVATE;
                    published = v.visibility() == Visibility.PUBLIC;
                }
                case BuildEvent.Created c -> published |= build.visibility() == Visibility.PUBLIC;
                case BuildEvent.Saved s -> published |= build.visibility() == Visibility.PUBLIC;
                case BuildEvent.Renamed r -> {
                }
            }
        }
        if (deleted) {
            events.publishEvent(new BuildWithdrawn(build.id(), build.ownerId(), BuildWithdrawn.Reason.DELETED));
        }
        else if (wentPrivate) {
            events.publishEvent(new BuildWithdrawn(build.id(), build.ownerId(), BuildWithdrawn.Reason.PRIVATE));
        }
        else if (published && build.visibility() == Visibility.PUBLIC) {
            events.publishEvent(new BuildPublished(build.id(), build.ownerId(), build.current().number()));
        }
    }
}
