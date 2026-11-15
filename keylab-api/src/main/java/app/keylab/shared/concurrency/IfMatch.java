package app.keylab.shared.concurrency;

import app.keylab.shared.problem.ApiProblem;
import app.keylab.shared.problem.ProblemTypes;

/**
 * The {@code If-Match} check for PATCH and DELETE on builds, profiles and
 * catalog items: the change goes through only if the client's tag is still
 * the resource's current one.
 *
 * <pre>
 * IfMatch.check(request.getHeader("If-Match"), ETags.of(build.version()));
 * </pre>
 */
public final class IfMatch {

    private IfMatch() {
    }

    /**
     * @param header the raw If-Match header, or null when the client sent none
     * @param currentETag the resource's tag now, as ETags built it
     * @throws ApiProblem 400 if_match_required when the header is missing,
     *         412 precondition_failed when no tag in it is the current one
     */
    public static void check(String header, String currentETag) {
        if (header == null || header.isBlank()) {
            throw ApiProblem.of(ProblemTypes.BAD_REQUEST, "if_match_required",
                    "Send If-Match with the ETag from your last GET");
        }
        for (String candidate : header.split(",")) {
            String tag = candidate.trim();
            // "*" matches any current version. Weak tags (W/"...") never match:
            // If-Match compares strongly (RFC 9110, 13.1.1).
            if (tag.equals("*") || tag.equals(currentETag)) {
                return;
            }
        }
        throw ApiProblem.of(ProblemTypes.PRECONDITION_FAILED);
    }
}
