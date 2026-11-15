/**
 * Plans, subscription, checkout, invoices and webhooks (ACC-03 to ACC-08).
 *
 * <p>Other modules reach this one only through the types in this package or a
 * {@code @NamedInterface} package, and through events. It owns the Postgres
 * schema "billing" (db/migration/billing). See docs/keylab/modulith-plan.md.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = "shared")
package app.keylab.billing;
