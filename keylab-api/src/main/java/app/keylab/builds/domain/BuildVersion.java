package app.keylab.builds.domain;

/**
 * One save of a build's parts, never changed afterwards. Share links and
 * typing results point at a version, so a later edit never changes what was
 * already shared.
 *
 * @param number 1 for the first save, then n + 1
 * @param keycaps null when the build has no keycap set
 */
public record BuildVersion(int number, Parts parts, KeycapLook keycaps, Sound sound) {
}
