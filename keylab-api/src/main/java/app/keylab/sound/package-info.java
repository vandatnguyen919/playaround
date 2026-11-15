/**
 * Uploads, recordings, processing and the sound recipe (ADM-04/05, BLD-10).
 *
 * <p>Other modules reach this one only through the types in this package or a
 * {@code @NamedInterface} package, and through events. It owns the Postgres
 * schema "sound" (db/migration/sound). See docs/keylab/modulith-plan.md.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = "shared")
package app.keylab.sound;
