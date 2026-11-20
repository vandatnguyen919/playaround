package app.keylab.catalog.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import app.keylab.catalog.domain.PartSounds.CaseSound;
import app.keylab.catalog.domain.PartSounds.ModSound;
import app.keylab.catalog.domain.PartSounds.Steps;
import app.keylab.catalog.domain.PartSounds.SwitchSound;
import app.keylab.catalog.domain.PartSounds.Take;
import app.keylab.catalog.domain.SoundRecipe.ModLevel;

import org.junit.jupiter.api.Test;

/**
 * BLD-10's rule on its own (US-05): steps add up, levels scale them, case
 * parts multiply, everything is clamped, and the order of the parts never
 * matters. Mod values are the KL2-1 seed.
 */
class SoundRecipeTest {

    static final ModSound LUBE = new ModSound("lube", List.of("none", "light", "heavy"), new Steps(-1, 1, -1, -1));
    static final ModSound FOAM = new ModSound("case-foam", null, new Steps(0, 1, -2, -2));
    static final ModSound PE = new ModSound("pe-foam", null, new Steps(1, 1, 0, -1));
    static final ModSound STABS = new ModSound("stabs", null, new Steps(0, 0, -1, -3));
    static final ModSound O_RINGS = new ModSound("o-rings", null, new Steps(-1, 0, -2, 0));

    static final Take STOCK_PRESS = take("stock", "press");
    static final Take STOCK_RELEASE = take("stock", "release");
    static final Take LUBED_PRESS = take("lubed", "press");
    static final SwitchSound MILK = new SwitchSound(UUID.randomUUID(), null,
            List.of(STOCK_PRESS, STOCK_RELEASE, LUBED_PRESS));

    @Test
    void stockIsTheSwitchAsItIsBalancedWithFlatFilters() {
        SoundRecipe stock = recipe(List.of());
        assertThat(stock.filters()).isEqualTo(new SoundRecipe.Filters(0, 0, 0.12, 0));
        assertThat(stock.meter()).isEqualTo(new SoundRecipe.Meter(0.5, "Balanced"));
        assertThat(stock.samples()).containsExactly(STOCK_PRESS, STOCK_RELEASE);
    }

    @Test
    void theMeterStartsFromTheSwitchProfile() {
        assertThat(SoundRecipe.of(sw("deep"), "stock", List.of(), null, null, null, null).meter())
            .isEqualTo(new SoundRecipe.Meter(0.38, "Deep & rounded"));
        assertThat(SoundRecipe.of(sw("clacky"), "stock", List.of(), null, null, null, null).meter())
            .isEqualTo(new SoundRecipe.Meter(0.7, "Bright & poppy"));
    }

    @Test
    void everyDeepeningModMovesTheMeterDeeperAndPeBrighter() {
        double stock = position(List.of());
        for (ModSound mod : List.of(FOAM, STABS, O_RINGS)) {
            assertThat(position(List.of(new ModLevel(mod, 1)))).as(mod.slug()).isLessThan(stock);
        }
        assertThat(position(List.of(new ModLevel(LUBE, 1)))).isLessThan(stock);
        assertThat(position(List.of(new ModLevel(PE, 1)))).isGreaterThan(stock);
    }

    @Test
    void aSecondLevelCountsTwiceAndTheOffLevelNothing() {
        SoundRecipe light = recipe(List.of(new ModLevel(LUBE, 1)));
        SoundRecipe heavy = recipe(List.of(new ModLevel(LUBE, 2)));
        assertThat(recipe(List.of(new ModLevel(LUBE, 0)))).isEqualTo(recipe(List.of()));
        // Lube light: low shelf 1.5 * 1 + 1 = 2.5 dB, high shelf 2 * -1 + 0.5 * -1 = -2.5 dB, gain -1.5 dB.
        assertThat(light.filters()).isEqualTo(new SoundRecipe.Filters(2.5, -2.5, 0.105, -1.5));
        assertThat(heavy.filters()).isEqualTo(new SoundRecipe.Filters(5, -5, 0.09, -3));
        assertThat(heavy.meter().position()).isLessThan(light.meter().position());
    }

    @Test
    void theDesignedStartingBuildSoundsDeepAndMuted() {
        // ModsDesktop's start: light lube, case foam, stabilizer tuning.
        SoundRecipe recipe = recipe(List.of(new ModLevel(LUBE, 1), new ModLevel(FOAM, 1), new ModLevel(STABS, 1)));
        assertThat(recipe.meter().word()).isEqualTo("Deep & muted");
        assertThat(recipe.filters().reverbMix()).isLessThan(0.12);
    }

    @Test
    void theMeterMovesWithEveryModAddedEvenAfterManyDeepeningOnes() {
        // A deep switch, mods turned on one after the other as in the e2e test.
        SwitchSound deep = sw("deep");
        List<ModLevel> mods = new ArrayList<>();
        double last = SoundRecipe.of(deep, "stock", mods, null, null, null, null).meter().position();
        for (ModLevel next : List.of(new ModLevel(FOAM, 1), new ModLevel(STABS, 1), new ModLevel(LUBE, 1),
                new ModLevel(LUBE, 2), new ModLevel(PE, 1), new ModLevel(O_RINGS, 1))) {
            mods.removeIf((m) -> m.mod() == next.mod());
            mods.add(next);
            double now = SoundRecipe.of(deep, "stock", mods, null, null, null, null).meter().position();
            assertThat(now).as(next.mod().slug()).isNotEqualTo(last).isStrictlyBetween(0.0, 1.0);
            last = now;
        }
    }

    @Test
    void theOrderOfTheModsNeverMatters() {
        List<ModLevel> mods = new ArrayList<>(List.of(new ModLevel(LUBE, 2), new ModLevel(FOAM, 1),
                new ModLevel(PE, 1), new ModLevel(STABS, 1), new ModLevel(O_RINGS, 1)));
        SoundRecipe first = recipe(mods);
        for (int i = 0; i < 5; i++) {
            Collections.shuffle(mods);
            assertThat(recipe(mods)).isEqualTo(first);
        }
    }

    @Test
    void caseKeycapsAndExtremesStayInRange() {
        CaseSound brass = new CaseSound(1.12, 0.1, 1, 0.9);
        CaseSound pom = new CaseSound(0.82, -0.12, 1, 1.15);
        SoundRecipe bright = SoundRecipe.of(sw("clacky"), "stock", List.of(new ModLevel(PE, 9)), 1.0,
                new CaseSound(1.12, 0.05, 1.2, 0.85), brass, new CaseSound(1.05, 0, 1.1, 1));
        SoundRecipe deep = SoundRecipe.of(MILK, "stock", List.of(new ModLevel(LUBE, 9), new ModLevel(O_RINGS, 9)), -1.0,
                new CaseSound(0.9, -0.08, 0.85, 1.1), pom, new CaseSound(0.92, 0, 0.85, 1.05));
        assertThat(bright.filters().highShelfDb()).isEqualTo(12);
        assertThat(bright.meter().word()).isEqualTo("Bright & poppy");
        assertThat(bright.meter().position()).isBetween(0.9, 1.0);
        assertThat(deep.filters().gainDb()).isEqualTo(-12);
        assertThat(deep.filters().lowShelfDb()).isEqualTo(12);
        assertThat(deep.meter().word()).isEqualTo("Deep & muted");
        assertThat(deep.meter().position()).isBetween(0.0, 0.05);
        assertThat(deep.filters().reverbMix()).isBetween(0.0, 0.4);
        // A brighter keycap set lifts the meter, a deeper one lowers it.
        assertThat(SoundRecipe.of(MILK, "stock", List.of(), 0.5, null, null, null).meter().position())
            .isGreaterThan(0.5);
        assertThat(SoundRecipe.of(MILK, "stock", List.of(), -0.5, null, null, null).meter().position())
            .isLessThan(0.5);
    }

    @Test
    void aVariantPlaysItsOwnTakesAndFallsBackToStockPerStroke() {
        assertThat(SoundRecipe.of(MILK, "lubed", List.of(), null, null, null, null).samples())
            .containsExactly(LUBED_PRESS, STOCK_RELEASE);
        assertThat(SoundRecipe.of(MILK, "foam", List.of(), null, null, null, null).samples())
            .containsExactly(STOCK_PRESS, STOCK_RELEASE);
        assertThat(SoundRecipe.of(new SwitchSound(UUID.randomUUID(), null, List.of()), "stock", List.of(), null, null,
                null, null).samples()).isEmpty();
    }

    @Test
    void wordsFollowTheMeterBands() {
        assertThat(SoundRecipe.word(0.7)).isEqualTo("Bright & poppy");
        assertThat(SoundRecipe.word(0.69)).isEqualTo("Balanced");
        assertThat(SoundRecipe.word(0.5)).isEqualTo("Balanced");
        assertThat(SoundRecipe.word(0.49)).isEqualTo("Deep & rounded");
        assertThat(SoundRecipe.word(0.28)).isEqualTo("Deep & rounded");
        assertThat(SoundRecipe.word(0.27)).isEqualTo("Deep & muted");
    }

    static SoundRecipe recipe(List<ModLevel> mods) {
        return SoundRecipe.of(MILK, "stock", mods, null, null, null, null);
    }

    static double position(List<ModLevel> mods) {
        return recipe(mods).meter().position();
    }

    static SwitchSound sw(String profile) {
        return new SwitchSound(UUID.randomUUID(), profile, List.of(STOCK_PRESS, STOCK_RELEASE));
    }

    static Take take(String variant, String stroke) {
        return new Take(UUID.randomUUID(), variant, stroke, "/v1/assets/sounds/" + variant + "-" + stroke + ".wav", 180,
                new BigDecimal("-14.5"), List.of(0.1, 0.8));
    }
}
