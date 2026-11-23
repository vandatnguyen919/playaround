package app.keylab.builds.domain;

import java.util.Locale;
import java.util.Optional;

/** Who may open a build: only its owner, or everyone with the link. */
public enum Visibility {
    PRIVATE, PUBLIC;

    /** "private" or "public", as the API spells them. */
    public static Optional<Visibility> from(String value) {
        if (value == null) {
            return Optional.empty();
        }
        return switch (value) {
            case "private" -> Optional.of(PRIVATE);
            case "public" -> Optional.of(PUBLIC);
            default -> Optional.empty();
        };
    }

    public String wire() {
        return name().toLowerCase(Locale.ROOT);
    }
}
