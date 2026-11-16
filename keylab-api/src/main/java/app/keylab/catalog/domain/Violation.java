package app.keylab.catalog.domain;

/**
 * One thing to fix in a switch's specs.
 *
 * @param pointer JSON Pointer of the field, such as {@code /forceCurve/2/travelMm}, so a form can show it
 * @param code stable reason, such as {@code out_of_range}
 * @param message what to do, for the editor
 */
public record Violation(String pointer, String code, String message) {
}
