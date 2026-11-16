package app.keylab.catalog.domain;

/** Another switch took the slug between the check and the write. */
public final class SlugTaken extends CatalogException {

    public SlugTaken(Throwable cause) {
        super("Another switch just took this slug");
        initCause(cause);
    }
}
