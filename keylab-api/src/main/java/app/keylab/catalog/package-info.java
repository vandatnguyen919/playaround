/**
 * Switches, keycap sets, mods, case options and publishing (CAT, ADM-02/03/06/07).
 *
 * <p>Other modules reach this one only through the types in this package or a
 * {@code @NamedInterface} package, and through events. It owns the Postgres
 * schema "catalog" (db/migration/catalog). See docs/keylab/modulith-plan.md.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = "shared")
package app.keylab.catalog;
