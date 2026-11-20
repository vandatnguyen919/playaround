package app.keylab.catalog.query;

import java.util.List;

/** The active case materials, plates and mounts, in screen order (CAT-08). */
public record CaseOptionsView(List<Part> materials, List<Part> plates, List<Part> mounts) {

    /**
     * One pick. {@code colors} is set for case materials only; {@code note} is
     * the line that says how it sounds.
     */
    public record Part(String slug, String name, String note, List<String> colors) {
    }
}
