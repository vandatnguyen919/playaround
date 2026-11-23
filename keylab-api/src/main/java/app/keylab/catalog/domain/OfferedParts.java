package app.keylab.catalog.domain;

import java.util.Collection;
import java.util.Optional;
import java.util.Set;

import org.jmolecules.architecture.hexagonal.SecondaryPort;

/**
 * Outbound port: which parts the builder offers today (US-08). A saved build
 * may use only these; {@link PartSounds} also resolves retired parts, so old
 * builds keep playing.
 */
@SecondaryPort
public interface OfferedParts {

    /** Published, not a draft and not pulled. */
    boolean switchOffered(String slug);

    /** The named mods that are live. */
    Set<String> liveMods(Collection<String> slugs);

    /** A published keycap set's profile and material. */
    Optional<KeycapLook> keycapSet(String slug);

    boolean caseMaterialOffered(String id);

    boolean plateOffered(String id);

    boolean mountOffered(String id);

    record KeycapLook(String profile, String material) {
    }
}
