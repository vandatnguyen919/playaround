/**
 * The builds domain: the Build aggregate, its value objects, events and
 * errors, and the outbound ports ({@code @SecondaryPort}) it is stored and
 * checked through. No Spring, Jackson, jakarta or problem+json (BuildsArchitectureTest).
 */
@Port
package app.keylab.builds.domain;

import org.jmolecules.architecture.hexagonal.Port;
