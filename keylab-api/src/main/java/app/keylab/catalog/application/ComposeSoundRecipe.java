package app.keylab.catalog.application;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

import app.keylab.catalog.domain.InvalidSoundMix;
import app.keylab.catalog.domain.PartSounds;
import app.keylab.catalog.domain.PartSounds.CaseSound;
import app.keylab.catalog.domain.PartSounds.ModSound;
import app.keylab.catalog.domain.PartSounds.SwitchSound;
import app.keylab.catalog.domain.SoundMix;
import app.keylab.catalog.domain.SoundMix.ModPick;
import app.keylab.catalog.domain.SoundRecipe;
import app.keylab.catalog.domain.SoundRecipe.ModLevel;
import app.keylab.catalog.domain.Violation;

import org.jmolecules.architecture.hexagonal.PrimaryPort;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * BLD-10 (US-05): the sound recipe for a parts mix. Loads each part's effect
 * and the switch's takes through {@link PartSounds} and hands them to
 * {@link SoundRecipe}. Every bad part is reported at once, one violation each.
 */
@PrimaryPort
@Service
public class ComposeSoundRecipe {

    private final PartSounds parts;

    ComposeSoundRecipe(PartSounds parts) {
        this.parts = parts;
    }

    /** @throws InvalidSoundMix when a part is unknown or a mod's level is missing or not offered */
    @Transactional(readOnly = true)
    public SoundRecipe compose(SoundMix mix) {
        List<Violation> violations = new ArrayList<>();
        Optional<SwitchSound> sw = parts.switchSound(mix.switchSlug());
        if (sw.isEmpty()) {
            violations.add(notFound("/switch", "No switch with this name"));
        }

        Map<String, ModSound> mods = parts.mods(mix.mods().stream().map(ModPick::slug).toList());
        List<ModLevel> levels = new ArrayList<>();
        for (int i = 0; i < mix.mods().size(); i++) {
            ModPick pick = mix.mods().get(i);
            String pointer = "/mod/" + i;
            ModSound mod = mods.get(pick.slug());
            if (mod == null) {
                violations.add(notFound(pointer, "No mod with this name"));
            }
            else if (!mod.isLevelMod()) {
                if (pick.level() != null) {
                    violations.add(new Violation(pointer, "level_not_offered", "This mod is on or off, with no levels"));
                }
                else {
                    levels.add(new ModLevel(mod, 1));
                }
            }
            else if (pick.level() == null) {
                violations.add(new Violation(pointer, "level_required",
                        "Pick a level: " + String.join(", ", mod.levels())));
            }
            else if (!mod.levels().contains(pick.level())) {
                violations.add(new Violation(pointer, "level_not_offered",
                        "This mod offers " + String.join(", ", mod.levels())));
            }
            else {
                levels.add(new ModLevel(mod, mod.levels().indexOf(pick.level())));
            }
        }

        BigDecimal shift = optional(mix.keycapSet(), parts::keycapShift, "/keycap_set",
                "No keycap set with this name", violations);
        CaseSound material = optional(mix.caseMaterial(), parts::caseMaterial, "/case_material",
                "No case material with this name", violations);
        CaseSound plate = optional(mix.plate(), parts::plate, "/plate", "No plate with this name", violations);
        CaseSound mount = optional(mix.mount(), parts::mount, "/mount", "No mount with this name", violations);

        if (!violations.isEmpty()) {
            throw new InvalidSoundMix(violations);
        }
        return SoundRecipe.of(sw.orElseThrow(), mix.variant(), levels, shift == null ? null : shift.doubleValue(),
                material, plate, mount);
    }

    /** A part the mix may leave out: null when it did, else the part or a violation. */
    private static <T> T optional(String slug, Function<String, Optional<T>> load, String pointer, String message,
            List<Violation> violations) {
        if (slug == null) {
            return null;
        }
        Optional<T> part = load.apply(slug);
        if (part.isEmpty()) {
            violations.add(notFound(pointer, message));
            return null;
        }
        return part.get();
    }

    private static Violation notFound(String pointer, String message) {
        return new Violation(pointer, "part_not_found", message);
    }
}
