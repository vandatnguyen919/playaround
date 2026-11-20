package app.keylab.catalog.domain;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.jmolecules.architecture.hexagonal.SecondaryPort;

/**
 * Outbound port: what the sound recipe needs from the catalog tables, each
 * part's {@code sound_fx} and a switch's ready takes (BLD-10). Every part
 * that was ever offered resolves, pulled or retired ones included, so an old
 * shared build still plays; drafts never do.
 */
@SecondaryPort
public interface PartSounds {

    /** A published or pulled switch with its ready takes. */
    Optional<SwitchSound> switchSound(String slug);

    /** The named mods that exist, live or switched off, by slug. */
    Map<String, ModSound> mods(Collection<String> slugs);

    /** A published or hidden keycap set's shift, -1 deeper to +1 brighter. */
    Optional<BigDecimal> keycapShift(String slug);

    Optional<CaseSound> caseMaterial(String id);

    Optional<CaseSound> plate(String id);

    Optional<CaseSound> mount(String id);

    /**
     * @param profile deep, poppy, clacky, muted, or null when not set
     */
    record SwitchSound(UUID id, String profile, List<Take> takes) {

        public SwitchSound {
            takes = List.copyOf(takes);
        }
    }

    /** A ready recording (Recording in openapi-v1.yaml). */
    record Take(UUID id, String variant, String stroke, String url, Integer durationMs, BigDecimal loudnessLufs,
            List<Double> peaks) {
    }

    /**
     * A mod's effect, steps from -3 to +3 on each slider.
     *
     * @param levels null for a toggle mod; for a level mod the first is off
     */
    record ModSound(String slug, List<String> levels, Steps steps) {

        public boolean isLevelMod() {
            return levels != null;
        }
    }

    record Steps(int pitch, int thock, int volume, int rattle) {
    }

    /**
     * A case material, plate or mount: pitch, decay and thump multiply, bright
     * adds. A factor the row does not hold is neutral (1, or 0 for bright).
     */
    record CaseSound(double pitch, double bright, double decay, double thump) {

        public static final CaseSound NEUTRAL = new CaseSound(1, 0, 1, 1);
    }
}
