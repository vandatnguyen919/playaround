package app.keylab.catalog.domain;

import java.util.ArrayList;
import java.util.List;

import app.keylab.catalog.domain.PartSounds.CaseSound;
import app.keylab.catalog.domain.PartSounds.ModSound;
import app.keylab.catalog.domain.PartSounds.SwitchSound;
import app.keylab.catalog.domain.PartSounds.Take;

/**
 * How a parts mix sounds (BLD-10, decision 0001): the takes to play, four
 * filter settings for the browser, and the meter from 0 deep to 1 bright with
 * its word. A pure function of the parts' effects, so the builder, the
 * playground, a shared link and a saved build all hear the same thing.
 *
 * <p>The rule, in three steps:
 * <ol>
 * <li>Mods add up their slider steps (pitch, thock, volume, rattle). A level
 * mod's steps are for its first "on" level and scale with the level: the
 * second "on" level counts twice (lube heavy is twice lube light).</li>
 * <li>Case material, plate and mount multiply pitch, decay and thump and add
 * bright; the keycap set's shift (-1 deeper to +1 brighter) tilts the
 * shelves.</li>
 * <li>The shelves, gain and reverb follow from those, each clamped; the meter
 * starts from the switch's sound profile and moves with the tilt
 * (high shelf minus low shelf) and the gain, on a logistic curve so it never
 * pins at either end.</li>
 * </ol>
 * Every step is a sum or a product, so the order of the parts never matters.
 */
public record SoundRecipe(List<Take> samples, Filters filters, Meter meter) {

    /** Shelves in dB at about 250 Hz and 4 kHz, reverb wet mix 0..1, output gain in dB. */
    public record Filters(double lowShelfDb, double highShelfDb, double reverbMix, double gainDb) {
    }

    /** {@code position} 0 deep … 1 bright. */
    public record Meter(double position, String word) {
    }

    /** A mod in the mix with its level: 0 off, 1 the first "on" level, and so on. A toggle mod that is on is 1. */
    public record ModLevel(ModSound mod, int level) {
    }

    static final double SHELF_LIMIT_DB = 12;
    static final double GAIN_MIN_DB = -12;
    static final double GAIN_MAX_DB = 6;
    static final double REVERB_MAX = 0.4;
    /** Stock reverb: a bare case, before foam or case parts change the decay. */
    static final double REVERB_BASE = 0.12;
    /** How far the meter moves per unit of shift, around the switch's base. */
    static final double METER_SPREAD = 4;

    public static SoundRecipe of(SwitchSound sw, String variant, List<ModLevel> mods, Double keycapShift,
            CaseSound caseMaterial, CaseSound plate, CaseSound mount) {
        double pitch = 0;
        double thock = 0;
        double volume = 0;
        double rattle = 0;
        for (ModLevel m : mods) {
            int scale = Math.max(0, m.level());
            pitch += m.mod().steps().pitch() * scale;
            thock += m.mod().steps().thock() * scale;
            volume += m.mod().steps().volume() * scale;
            rattle += m.mod().steps().rattle() * scale;
        }
        CaseSound material = orNeutral(caseMaterial);
        CaseSound plateFx = orNeutral(plate);
        CaseSound mountFx = orNeutral(mount);
        double casePitch = material.pitch() * plateFx.pitch() * mountFx.pitch();
        double bright = material.bright() + plateFx.bright() + mountFx.bright();
        double decay = material.decay() * plateFx.decay() * mountFx.decay();
        double thump = material.thump() * plateFx.thump() * mountFx.thump();
        double shift = keycapShift == null ? 0 : keycapShift;

        double low = clamp(1.5 * thock - pitch + 12 * (thump - 1) - 2 * shift, -SHELF_LIMIT_DB, SHELF_LIMIT_DB);
        double high = clamp(2 * pitch + 0.5 * rattle + 24 * bright + 4 * shift + 10 * Math.log(casePitch),
                -SHELF_LIMIT_DB, SHELF_LIMIT_DB);
        double gain = clamp(1.5 * volume, GAIN_MIN_DB, GAIN_MAX_DB);
        double reverb = clamp(REVERB_BASE * decay + 0.015 * rattle, 0, REVERB_MAX);

        double position = meter(base(sw.profile()), (high - low) / 30 + gain / 48);
        return new SoundRecipe(samples(sw.takes(), variant),
                new Filters(round(low, 2), round(high, 2), round(reverb, 3), round(gain, 2)),
                new Meter(round(position, 3), word(position)));
    }

    /**
     * The meter for a shift away from the switch's own sound: on a logistic
     * curve through {@code base}, so every change moves it a little and no mix
     * pins it at either end (a clamp would stop it moving after a few mods).
     */
    static double meter(double base, double shift) {
        double logit = Math.log(base / (1 - base));
        return 1 / (1 + Math.exp(-(logit + METER_SPREAD * shift)));
    }

    /** Where the meter starts for a switch's sound profile, before any part. */
    static double base(String profile) {
        if (profile == null) {
            return 0.5;
        }
        return switch (profile) {
            case "muted" -> 0.32;
            case "deep" -> 0.38;
            case "poppy" -> 0.62;
            case "clacky" -> 0.7;
            default -> 0.5;
        };
    }

    /** The meter's word, in the bands of ModsDesktop. */
    static String word(double position) {
        if (position >= 0.7) {
            return "Bright & poppy";
        }
        if (position >= 0.5) {
            return "Balanced";
        }
        if (position >= 0.28) {
            return "Deep & rounded";
        }
        return "Deep & muted";
    }

    /** Press and release of {@code variant}, each falling back to stock when that variant has no ready take. */
    static List<Take> samples(List<Take> takes, String variant) {
        List<Take> chosen = new ArrayList<>(2);
        for (String stroke : List.of("press", "release")) {
            Take take = find(takes, variant, stroke);
            if (take == null) {
                take = find(takes, "stock", stroke);
            }
            if (take != null) {
                chosen.add(take);
            }
        }
        return List.copyOf(chosen);
    }

    private static Take find(List<Take> takes, String variant, String stroke) {
        return takes.stream()
            .filter((t) -> t.variant().equals(variant) && t.stroke().equals(stroke))
            .findFirst()
            .orElse(null);
    }

    private static CaseSound orNeutral(CaseSound sound) {
        return sound == null ? CaseSound.NEUTRAL : sound;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    /** Rounded, and never -0.0, so equal mixes write equal JSON (and share an ETag). */
    private static double round(double value, int places) {
        double factor = Math.pow(10, places);
        return Math.round(value * factor) / factor + 0.0;
    }
}
