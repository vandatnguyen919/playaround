/**
 * What every module may use: ids and money, and the API ground rules from
 * docs/keylab/api-design-v1.md (problem+json errors, paging, ETag and
 * If-Match, Idempotency-Key, security, the revision header, migrations).
 * No domain code and never JPA entities.
 */
@org.springframework.modulith.ApplicationModule(type = org.springframework.modulith.ApplicationModule.Type.OPEN)
package app.keylab.shared;
