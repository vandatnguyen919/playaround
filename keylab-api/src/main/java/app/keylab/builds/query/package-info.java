/**
 * The read side for My builds (BLD-01) and the build answered after a save:
 * SQL straight to read models, never loading aggregates. Used only by
 * adapter/in/web.
 */
@PrimaryPort
package app.keylab.builds.query;

import org.jmolecules.architecture.hexagonal.PrimaryPort;
