package app.keylab.catalog.domain;

/**
 * Where a switch is in its life: every switch starts as a {@link #DRAFT},
 * only publishing (ADM-03) puts it in the library, and pulling it makes it
 * {@link #HIDDEN} (it stays for the builds that use it).
 */
public enum Status {

    DRAFT("draft"), PUBLISHED("published"), HIDDEN("hidden");

    private final String wire;

    Status(String wire) {
        this.wire = wire;
    }

    /** The word stored in {@code catalog.switches.status} and sent by the API. */
    public String wire() {
        return wire;
    }

    public static Status fromWire(String value) {
        for (Status status : values()) {
            if (status.wire.equals(value)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown switch status " + value);
    }
}
