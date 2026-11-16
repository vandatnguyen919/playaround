/**
 * The read side for lists and detail pages: SQL straight to read models,
 * never loading aggregates. Used only by adapter/in/web.
 */
@PrimaryPort
package app.keylab.catalog.query;

import org.jmolecules.architecture.hexagonal.PrimaryPort;
