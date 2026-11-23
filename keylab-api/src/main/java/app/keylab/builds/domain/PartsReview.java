package app.keylab.builds.domain;

import java.util.List;

/**
 * The catalog's answer on a build's parts.
 *
 * @param violations one per part that is unknown, retired or at a level its mod does not offer
 * @param keycaps null when there are violations or no keycap set
 * @param sound null when there are violations
 */
public record PartsReview(List<Violation> violations, KeycapLook keycaps, Sound sound) {

    public PartsReview {
        violations = List.copyOf(violations);
    }
}
