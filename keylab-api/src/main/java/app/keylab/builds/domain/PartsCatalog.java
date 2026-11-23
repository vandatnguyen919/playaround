package app.keylab.builds.domain;

import org.jmolecules.architecture.hexagonal.SecondaryPort;

/**
 * Outbound port: whether a build's parts are offered today, each mod at a
 * level it offers, and how they sound together (the BLD-10 recipe).
 */
@SecondaryPort
public interface PartsCatalog {

    /** Called only with parts whose own rules hold ({@link Parts#violations()} is empty). */
    PartsReview review(Parts parts);
}
