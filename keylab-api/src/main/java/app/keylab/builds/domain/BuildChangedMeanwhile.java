package app.keylab.builds.domain;

/** The build moved past the version this change was based on. */
public final class BuildChangedMeanwhile extends BuildsException {

    public BuildChangedMeanwhile() {
        super("The build changed since it was loaded");
    }
}
