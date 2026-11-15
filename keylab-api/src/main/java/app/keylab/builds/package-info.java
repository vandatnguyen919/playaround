/**
 * Builds, parts list, share image and guest import (BLD-01 to BLD-09).
 *
 * <p>Other modules reach this one only through the types in this package or a
 * {@code @NamedInterface} package, and through events. It owns the Postgres
 * schema "builds" (db/migration/builds). See docs/keylab/modulith-plan.md.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = "shared")
package app.keylab.builds;
