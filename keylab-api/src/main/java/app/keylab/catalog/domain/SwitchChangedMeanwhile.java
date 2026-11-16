package app.keylab.catalog.domain;

/** The switch moved past the version this change was based on. */
public final class SwitchChangedMeanwhile extends CatalogException {

    public SwitchChangedMeanwhile() {
        super("The switch changed since it was loaded");
    }
}
