/**
 * Team roles, app settings, audit log and overview metrics (ADM-01, ADM-11 to ADM-13).
 *
 * <p>Other modules reach this one only through the types in this package or a
 * {@code @NamedInterface} package, and through events. It owns the Postgres
 * schema "backoffice" (db/migration/backoffice). See docs/keylab/modulith-plan.md.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = "shared")
package app.keylab.backoffice;
