package app.keylab.builds.domain;

/**
 * How a version sounds, from the catalog's recipe (BLD-10) when it was
 * saved: shelves and gain in dB, reverb mix, and the meter (0 deep … 1
 * bright) with its word. Kept in {@code config.sound}.
 */
public record Sound(double lowShelfDb, double highShelfDb, double reverbMix, double gainDb, double meterPosition,
        String meterWord) {
}
