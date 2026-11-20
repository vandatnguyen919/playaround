package app.keylab.catalog.query;

import app.keylab.catalog.domain.CatalogException;

/** No published keycap set with this slug (CAT-06): drafts and hidden sets are not found either. */
public final class KeycapSetNotFound extends CatalogException {

    public KeycapSetNotFound() {
        super("No keycap set with this name");
    }
}
