package app.keylab.builds.domain;

/**
 * No build with this id for this caller: unknown, deleted, or someone else's.
 * Never "forbidden", so private builds do not leak.
 */
public final class BuildNotFound extends BuildsException {

    public BuildNotFound() {
        super("No build with this id");
    }
}
