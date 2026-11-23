package app.keylab.catalog.application;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.Predicate;

import app.keylab.catalog.CatalogApi;
import app.keylab.catalog.domain.InvalidSoundMix;
import app.keylab.catalog.domain.OfferedParts;
import app.keylab.catalog.domain.SoundMix;
import app.keylab.catalog.domain.SoundMix.ModPick;
import app.keylab.catalog.domain.SoundRecipe;
import app.keylab.catalog.domain.Violation;

import org.jmolecules.architecture.hexagonal.PrimaryPort;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link CatalogApi#review} (US-08): a build's parts must resolve and play,
 * as BLD-10 checks them ({@link ComposeSoundRecipe}), and must be offered
 * today ({@link OfferedParts}). A part that only ever was offered is
 * {@code part_retired}.
 */
@PrimaryPort
@Service
public class ReviewBuildParts implements CatalogApi {

    private final ComposeSoundRecipe recipes;
    private final OfferedParts offered;

    ReviewBuildParts(ComposeSoundRecipe recipes, OfferedParts offered) {
        this.recipes = recipes;
        this.offered = offered;
    }

    @Override
    @Transactional(readOnly = true)
    public PartsReview review(PartsChoice parts) {
        List<Problem> problems = new ArrayList<>();
        SoundRecipe recipe = null;
        SoundMix mix = new SoundMix(parts.switchSlug(), parts.variant(),
                parts.mods().stream().map((m) -> new ModPick(m.slug(), m.level())).toList(), parts.keycapSet(),
                parts.caseMaterial(), parts.plate(), parts.mount());
        try {
            recipe = recipes.compose(mix);
        }
        catch (InvalidSoundMix invalid) {
            invalid.violations().forEach((v) -> problems.add(problem(v)));
        }

        retired(problems, Part.SWITCH, parts.switchSlug(), offered::switchOffered,
                "This switch is no longer in the library. Pick another.");
        Set<String> live = offered.liveMods(parts.mods().stream().map(ModChoice::slug).toList());
        for (int i = 0; i < parts.mods().size(); i++) {
            int index = i;
            if (!flagged(problems, Part.MOD, index) && !live.contains(parts.mods().get(i).slug())) {
                problems.add(new Problem(Part.MOD, index, "part_retired", "This mod is no longer offered."));
            }
        }
        Optional<OfferedParts.KeycapLook> look = parts.keycapSet() == null ? Optional.empty()
                : offered.keycapSet(parts.keycapSet());
        retired(problems, Part.KEYCAP_SET, parts.keycapSet(), (slug) -> look.isPresent(),
                "This keycap set is no longer offered. Pick another.");
        retired(problems, Part.CASE_MATERIAL, parts.caseMaterial(), offered::caseMaterialOffered,
                "This case material is no longer offered.");
        retired(problems, Part.PLATE, parts.plate(), offered::plateOffered, "This plate is no longer offered.");
        retired(problems, Part.MOUNT, parts.mount(), offered::mountOffered, "This mount is no longer offered.");

        if (!problems.isEmpty() || recipe == null) {
            return new PartsReview(problems, null, null);
        }
        Sound sound = new Sound(recipe.filters().lowShelfDb(), recipe.filters().highShelfDb(),
                recipe.filters().reverbMix(), recipe.filters().gainDb(), recipe.meter().position(),
                recipe.meter().word());
        return new PartsReview(List.of(),
                sound, look.map((l) -> new KeycapLook(l.profile(), l.material())).orElse(null));
    }

    /** A part that resolved for BLD-10 but is not offered any more. */
    private static void retired(List<Problem> problems, Part part, String key, Predicate<String> isOffered,
            String message) {
        if (key != null && !flagged(problems, part, 0) && !isOffered.test(key)) {
            problems.add(new Problem(part, 0, "part_retired", message));
        }
    }

    private static boolean flagged(List<Problem> problems, Part part, int index) {
        return problems.stream().anyMatch((p) -> p.part() == part && p.index() == index);
    }

    /** BLD-10 names the query parameter: /switch, /mod/1, /keycap_set, /case_material, /plate, /mount. */
    private static Problem problem(Violation v) {
        String pointer = v.pointer();
        if (pointer.startsWith("/mod/")) {
            return new Problem(Part.MOD, Integer.parseInt(pointer.substring("/mod/".length())), v.code(),
                    v.message());
        }
        Part part = switch (pointer) {
            case "/switch" -> Part.SWITCH;
            case "/keycap_set" -> Part.KEYCAP_SET;
            case "/case_material" -> Part.CASE_MATERIAL;
            case "/plate" -> Part.PLATE;
            case "/mount" -> Part.MOUNT;
            default -> throw new IllegalStateException("No part for " + pointer);
        };
        return new Problem(part, 0, v.code(), v.message());
    }
}
