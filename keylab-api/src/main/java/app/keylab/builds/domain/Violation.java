package app.keylab.builds.domain;

/**
 * One thing to fix in a build.
 *
 * @param pointer JSON Pointer of the field in the build body, such as {@code /mods/1}, so a form can show it
 * @param code stable reason, such as {@code part_retired}
 * @param message what to do, for the member
 */
public record Violation(String pointer, String code, String message) {
}
