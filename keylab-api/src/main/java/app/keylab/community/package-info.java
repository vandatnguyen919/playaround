/**
 * Profiles, follows, likes, collections, activity, badges and reports (ME, SOC).
 *
 * <p>Other modules reach this one only through the types in this package or a
 * {@code @NamedInterface} package, and through events. It owns the Postgres
 * schema "community" (db/migration/community). See docs/keylab/modulith-plan.md.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = "shared")
package app.keylab.community;
