package app.keylab.builds.domain;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A build's choices, as catalog slugs and ids (BuildParts in openapi-v1.yaml):
 * layout, switch and variant, mods with their levels, keycap set, case
 * material, colour, plate and mount, and desk pad. A part left out is null.
 * {@link #violations()} checks what can be checked without the catalog;
 * {@link PartsCatalog} checks the rest.
 *
 * @param variant stock, lubed or foam; stock when not given
 * @param mods in the order the member added them
 * @param caseColor {@code #RRGGBB}, kept upper case
 */
public record Parts(String layout, String switchSlug, String variant, List<ModChoice> mods, String keycapSet,
        String caseMaterial, String caseColor, String plate, String mount, String deskPad) {

    public static final List<String> LAYOUTS = List.of("60", "65", "75", "tkl", "full");
    public static final List<String> VARIANTS = List.of("stock", "lubed", "foam");
    private static final Pattern COLOR = Pattern.compile("^#[0-9A-F]{6}$");
    private static final Pattern DESK_PAD = Pattern.compile("^[a-z0-9-]{1,32}$");

    /** @param level null for a toggle mod */
    public record ModChoice(String slug, String level) {
    }

    public Parts {
        variant = variant == null ? "stock" : variant;
        mods = mods == null ? List.of() : List.copyOf(mods);
        caseColor = caseColor == null ? null : caseColor.toUpperCase(Locale.ROOT);
    }

    /** The rules that need no catalog: required parts, known layout and variant, colour, no mod twice. */
    public List<Violation> violations() {
        List<Violation> found = new ArrayList<>();
        if (layout == null) {
            found.add(new Violation("/layout", "required", "Pick a layout."));
        }
        else if (!LAYOUTS.contains(layout)) {
            found.add(new Violation("/layout", "not_allowed", "Pick one of " + String.join(", ", LAYOUTS) + "."));
        }
        if (blank(switchSlug)) {
            found.add(new Violation("/switch/slug", "required", "Pick a switch."));
        }
        if (!VARIANTS.contains(variant)) {
            found.add(new Violation("/switch/variant", "not_allowed",
                    "Pick one of " + String.join(", ", VARIANTS) + "."));
        }
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < mods.size(); i++) {
            ModChoice mod = mods.get(i);
            if (mod == null || blank(mod.slug())) {
                found.add(new Violation("/mods/" + i, "required", "Name the mod."));
            }
            else if (!seen.add(mod.slug())) {
                found.add(new Violation("/mods/" + i, "duplicate", "This mod is in the build already."));
            }
        }
        if (caseColor != null && !COLOR.matcher(caseColor).matches()) {
            found.add(new Violation("/case/color", "invalid_color", "Use a colour like #2B4677."));
        }
        if (deskPad != null && !DESK_PAD.matcher(deskPad).matches()) {
            found.add(new Violation("/deskPad", "not_allowed", "Pick one of the desk pads."));
        }
        return found;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
