/**
 * Builds, parts list, share image and guest import (BLD-01 to BLD-09).
 *
 * <p>Other modules reach this one only through the types in this package or a
 * {@code @NamedInterface} package, and through events. It owns the Postgres
 * schema "builds" (db/migration/builds). See docs/keylab/modulith-plan.md.
 *
 * <p>It checks a build's parts and works out their sound through
 * {@code catalog}'s {@code CatalogApi} (US-08), so it depends on catalog.
 * {@code catalog} must therefore never refer to a builds type.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = { "shared", "catalog" })
package app.keylab.builds;
