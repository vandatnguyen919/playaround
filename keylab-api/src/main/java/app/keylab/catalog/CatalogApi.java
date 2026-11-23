package app.keylab.catalog;

import java.util.List;

/**
 * What other modules may ask the catalog. {@code builds} checks a build's
 * parts before it saves them, and keeps how they sound in {@code config.sound}
 * (US-08, modulith-plan.md).
 */
public interface CatalogApi {

    /**
     * Checks a build's parts and works out how they sound, with the same code
     * as BLD-10. A part must be offered today: a published switch and keycap
     * set, a live mod, an active case material, plate and mount. A mod's level
     * must be one the mod offers.
     *
     * @return the problems, one per bad part, or none with the sound and the keycap set's look
     */
    PartsReview review(PartsChoice parts);

    /**
     * Catalog slugs and ids as the builder sends them; a part left out is null.
     *
     * @param variant stock, lubed or foam
     */
    record PartsChoice(String switchSlug, String variant, List<ModChoice> mods, String keycapSet,
            String caseMaterial, String plate, String mount) {

        public PartsChoice {
            mods = List.copyOf(mods);
        }
    }

    /** @param level null for a toggle mod */
    record ModChoice(String slug, String level) {
    }

    enum Part {
        SWITCH, MOD, KEYCAP_SET, CASE_MATERIAL, PLATE, MOUNT
    }

    /**
     * One bad part.
     *
     * @param index the mod's place in {@link PartsChoice#mods()}, 0 for the other parts
     * @param code part_not_found, part_retired, level_required or level_not_offered
     */
    record Problem(Part part, int index, String code, String message) {
    }

    /** The filters and meter of BLD-10, without the samples. */
    record Sound(double lowShelfDb, double highShelfDb, double reverbMix, double gainDb, double meterPosition,
            String meterWord) {
    }

    /** What a keycap set is made of, so a build can show it. */
    record KeycapLook(String profile, String material) {
    }

    /**
     * @param sound null when there are problems
     * @param keycaps null when there are problems or no keycap set was chosen
     */
    record PartsReview(List<Problem> problems, Sound sound, KeycapLook keycaps) {

        public PartsReview {
            problems = List.copyOf(problems);
        }

        public boolean ok() {
            return problems.isEmpty();
        }
    }
}
