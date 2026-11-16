package app.keylab.catalog.domain;

/** No switch with this id, or no published switch with this slug. */
public final class SwitchNotFound extends CatalogException {

    /** How the caller looked for the switch, which the message names. */
    public enum Lookup {
        ID, SLUG
    }

    private final Lookup lookup;

    private SwitchNotFound(Lookup lookup) {
        super("No switch with this " + (lookup == Lookup.ID ? "id" : "name"));
        this.lookup = lookup;
    }

    public static SwitchNotFound byId() {
        return new SwitchNotFound(Lookup.ID);
    }

    public static SwitchNotFound bySlug() {
        return new SwitchNotFound(Lookup.SLUG);
    }

    public Lookup lookup() {
        return lookup;
    }
}
