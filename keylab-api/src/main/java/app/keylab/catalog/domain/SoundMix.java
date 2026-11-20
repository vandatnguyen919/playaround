package app.keylab.catalog.domain;

import java.util.List;

/**
 * A parts mix to hear (BLD-10): the switch and variant, the mods with their
 * levels, and the optional keycap set, case material, plate and mount. Slugs
 * as the builder sends them; a part left out (null) adds no effect.
 *
 * @param variant stock, lubed or foam: which takes to play
 * @param mods in request order, so a problem can point at {@code /mod/<index>}
 */
public record SoundMix(String switchSlug, String variant, List<ModPick> mods, String keycapSet,
        String caseMaterial, String plate, String mount) {

    public SoundMix {
        mods = List.copyOf(mods);
    }

    /**
     * One {@code mod} value: {@code slug} for a toggle mod, {@code slug:level}
     * for a level mod.
     *
     * @param level null when the value named no level
     */
    public record ModPick(String slug, String level) {
    }
}
