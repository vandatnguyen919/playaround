/**
 * Uploads, recordings and processing (ADM-04/05). The sound recipe (BLD-10)
 * is computed in catalog, next to its data (docs/keylab/decisions/0001).
 *
 * <p>Other modules reach this one only through the types in this package or a
 * {@code @NamedInterface} package, and through events. It owns the Postgres
 * schema "sound" (db/migration/sound). See docs/keylab/modulith-plan.md.
 *
 * <p>{@code catalog} depends on this module (it listens to
 * {@link app.keylab.sound.SoundProcessed}), so this module never refers to a
 * catalog type. What it needs to know about a switch it asks through
 * {@link app.keylab.sound.SwitchDirectory}, a port that catalog implements.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = "shared")
package app.keylab.sound;
