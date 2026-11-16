/**
 * Catalog use cases: load an aggregate through a port, call it, save it.
 * Transactions live here. Each use case is a {@code @PrimaryPort} the
 * adapters call; this package depends only on domain types and ports.
 */
@Application
package app.keylab.catalog.application;

import org.jmolecules.architecture.hexagonal.Application;
