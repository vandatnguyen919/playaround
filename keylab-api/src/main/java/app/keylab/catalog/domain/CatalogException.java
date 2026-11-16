package app.keylab.catalog.domain;

/**
 * A rule of the catalog said no. Each subtype is one stable reason; the web
 * adapter maps it to its RFC 9457 problem (adapter/in/web/CatalogProblems),
 * so nothing in the domain knows about HTTP.
 */
public abstract class CatalogException extends RuntimeException {

    protected CatalogException(String message) {
        super(message);
    }
}
