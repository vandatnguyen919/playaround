/**
 * Settings, identities, export, deletion and admin user actions (ACC-01/02/09/10, ADM-08).
 *
 * <p>Other modules reach this one only through the types in this package or a
 * {@code @NamedInterface} package, and through events. It owns the Postgres
 * schema "account" (db/migration/account). See docs/keylab/modulith-plan.md.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = "shared")
package app.keylab.account;
