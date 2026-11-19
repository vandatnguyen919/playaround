/**
 * Switches, keycap sets, mods, case options, publishing and the sound recipe
 * (CAT, ADM-02/03/06/07, BLD-10).
 *
 * <p>Other modules reach this one only through the types in this package or a
 * {@code @NamedInterface} package, and through events. It owns the Postgres
 * schema "catalog" (db/migration/catalog). See docs/keylab/modulith-plan.md.
 *
 * <p>It listens to {@code sound}'s {@code SoundProcessed} event (US-39), so it
 * depends on that one type. {@code sound} must therefore never refer to a
 * catalog type, or the modules form a cycle.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = { "shared", "sound" })
package app.keylab.catalog;
