package app.keylab.builds.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Checks a build as the member sent it all at once, so they see every field
 * to fix in one answer: the name, the visibility, the parts' own rules, then
 * the catalog's (asked only when the parts' own rules hold).
 */
public final class BuildRules {

    private BuildRules() {
    }

    /**
     * @param visibility null when none was asked for
     * @param review null when the catalog was not asked
     */
    public record Checked(Visibility visibility, PartsReview review) {
    }

    /**
     * @param visibility "private", "public" or null
     * @param reviewParts false when the parts did not change, so the catalog need not be asked
     * @throws InvalidBuild with every violation found
     */
    public static Checked check(String name, String visibility, Parts parts, PartsCatalog catalog,
            boolean reviewParts) {
        List<Violation> violations = new ArrayList<>(Build.nameViolations(name));
        Optional<Visibility> chosen = Visibility.from(visibility);
        if (visibility != null && chosen.isEmpty()) {
            violations.add(new Violation("/visibility", "not_allowed", "Pick private or public."));
        }
        List<Violation> partViolations = parts.violations();
        violations.addAll(partViolations);
        PartsReview review = null;
        if (reviewParts && partViolations.isEmpty()) {
            review = catalog.review(parts);
            violations.addAll(review.violations());
        }
        if (!violations.isEmpty()) {
            throw new InvalidBuild(violations);
        }
        return new Checked(chosen.orElse(null), review);
    }
}
