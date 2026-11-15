package app.keylab.shared.problem;

/**
 * One invalid field of a 422 answer.
 *
 * @param pointer JSON Pointer into the request body, for example {@code /links/website}
 * @param code stable, safe to switch on, for example {@code username_taken}
 * @param message text for the person, shown next to the field
 */
public record FieldError(String pointer, String code, String message) {
}
