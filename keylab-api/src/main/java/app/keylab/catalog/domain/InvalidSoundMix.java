package app.keylab.catalog.domain;

import java.util.List;

/**
 * Parts in a mix that cannot be heard (BLD-10): a slug that never named an
 * offered part ({@code part_not_found}), a level mod without its level
 * ({@code level_required}), or a level the mod does not offer
 * ({@code level_not_offered}). One violation per bad part; its pointer names
 * the query parameter, such as {@code /switch} or {@code /mod/1}.
 */
public class InvalidSoundMix extends CatalogException {

    private final List<Violation> violations;

    public InvalidSoundMix(List<Violation> violations) {
        super("Invalid sound mix: " + violations);
        this.violations = List.copyOf(violations);
    }

    public List<Violation> violations() {
        return violations;
    }
}
