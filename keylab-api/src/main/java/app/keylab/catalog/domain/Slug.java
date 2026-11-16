package app.keylab.catalog.domain;

import java.text.Normalizer;
import java.util.Locale;
import java.util.function.Predicate;

/** A switch's address in the library: lower case ASCII words joined by hyphens, unique. */
public final class Slug {

    public static final int MAX = 48;

    private Slug() {
    }

    /** "Gateron Milk Yellow Pro" to "gateron-milk-yellow-pro"; "switch" when nothing is left. */
    public static String base(String name) {
        String ascii = Normalizer.normalize(name, Normalizer.Form.NFKD).replaceAll("\\p{M}+", "");
        String slug = ascii.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
        if (slug.length() > MAX) {
            slug = slug.substring(0, MAX).replaceAll("-+$", "");
        }
        return slug.isEmpty() ? "switch" : slug;
    }

    /**
     * "coral-pop", or "coral-pop-2" and up when taken.
     *
     * @param own the switch's current slug, which it may keep, or null for a new switch
     */
    public static String firstFree(String name, Predicate<String> taken, String own) {
        String base = base(name);
        Predicate<String> free = (candidate) -> candidate.equals(own) || !taken.test(candidate);
        if (free.test(base)) {
            return base;
        }
        for (int n = 2;; n++) {
            String candidate = base + "-" + n;
            if (free.test(candidate)) {
                return candidate;
            }
        }
    }
}
