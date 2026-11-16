package app.keylab.catalog.domain;

/**
 * Whether the library can play a switch: {@link #RECORDED} once catalog holds
 * a ready stock press and stock release (US-39). Lubed and foam takes do not
 * count. Kept up to date from the sound module's events, not by editors.
 */
public enum SoundStatus {

    RECORDED("recorded"), MISSING("missing"), PROCESSING("processing");

    private final String wire;

    SoundStatus(String wire) {
        this.wire = wire;
    }

    /** The word stored in {@code catalog.switches.sound_status} and sent by the API. */
    public String wire() {
        return wire;
    }

    public static SoundStatus fromWire(String value) {
        for (SoundStatus status : values()) {
            if (status.wire.equals(value)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown sound status " + value);
    }
}
