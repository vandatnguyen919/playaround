package app.keylab.catalog.domain;

/** Only drafts can be deleted; a published switch may be in someone's build (US-37). */
public final class SwitchNotDraft extends CatalogException {

    public SwitchNotDraft() {
        super("Only drafts can be deleted");
    }
}
