package app.keylab.builds.domain;

/** What changed on a build since it was loaded, for {@link Builds#save} to write. */
public sealed interface BuildEvent {

    /** New parts: a new version that is now the current one. */
    record Saved(BuildVersion version) implements BuildEvent {
    }

    record Renamed(String name) implements BuildEvent {
    }

    record VisibilityChanged(Visibility visibility) implements BuildEvent {
    }
}
