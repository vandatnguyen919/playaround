package app.keylab.builds.query;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A build with its current version, as BLD-01, BLD-02 and BLD-04 answer it.
 *
 * @param version the row version, the ETag's value
 * @param keycapSet null when the build has no keycap set; profile and material go with it
 * @param caseMaterial null with the other case fields when no case part was chosen
 */
public record BuildRow(UUID id, String name, String visibility, long version, Instant createdAt, Instant updatedAt,
        String layout, String switchSlug, String variant, List<Mod> mods, String keycapSet, String keycapProfile,
        String keycapMaterial, String caseMaterial, String caseColor, String plate, String mount, String deskPad) {

    /** @param level null for a toggle mod */
    public record Mod(String slug, String level) {
    }
}
