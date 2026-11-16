package app.keylab.catalog.domain;

import java.util.Optional;
import java.util.UUID;

/** Outbound port: where {@link Switch} aggregates are kept ({@code catalog.switches}). */
public interface Switches {

    Optional<Switch> load(UUID id);

    /** @throws SlugTaken when another switch took the slug meanwhile */
    void add(Switch sw);

    /**
     * Writes the changes the switch recorded since it was loaded, then
     * publishes them. An edit is written only while the switch is still at
     * the version it was loaded at. Publishing is written only while the
     * stock sounds are still recorded, since they may be pulled meanwhile.
     *
     * @throws SwitchChangedMeanwhile when an edit lost a race with another one
     * @throws MissingRequiredSounds when the stock sounds went meanwhile
     * @throws SlugTaken when another switch took the new slug meanwhile
     */
    void save(Switch sw);

    /**
     * Deletes a draft, only while it is still at the version it was loaded at.
     *
     * @throws SwitchChangedMeanwhile when it changed, or is no longer a draft
     */
    void remove(Switch sw);

    boolean existsBySlug(String slug);
}
