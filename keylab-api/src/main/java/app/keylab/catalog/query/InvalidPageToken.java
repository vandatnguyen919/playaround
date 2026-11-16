package app.keylab.catalog.query;

import app.keylab.catalog.domain.CatalogException;

/** A page_token that no earlier page of this list handed out. */
public final class InvalidPageToken extends CatalogException {

    public InvalidPageToken() {
        super("page_token is not a token from a previous page");
    }
}
