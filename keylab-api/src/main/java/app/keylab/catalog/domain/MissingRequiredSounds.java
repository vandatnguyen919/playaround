package app.keylab.catalog.domain;

/** Publishing needs a ready stock press and stock release (US-39). */
public final class MissingRequiredSounds extends CatalogException {

    public MissingRequiredSounds() {
        super("The stock press and release sounds are not both ready");
    }
}
