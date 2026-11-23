package app.keylab.builds.domain;

/** What changed on a build since it was loaded, for {@link Builds#save} to write. */
public sealed interface BuildEvent {

    /** A new build, stored by {@link Builds#add}. */
    record Created() implements BuildEvent {
    }

    /** New parts: a new version that is now the current one. */
    record Saved(BuildVersion version) implements BuildEvent {
    }

    record Renamed(String name) implements BuildEvent {
    }

    record VisibilityChanged(Visibility visibility) implements BuildEvent {
    }

    /** Soft deleted (US-12): gone from every endpoint at once. */
    record Deleted(Visibility visibilityBefore) implements BuildEvent {
    }
}
