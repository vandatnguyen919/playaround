-- Flyway creates the schema "billing" and keeps its own history table in it
-- (ModuleMigrations). Tables arrive with the module's first user story.
-- No joins or foreign keys to another module's schema: refer by id only.
COMMENT ON SCHEMA billing IS 'KeyLab module billing: Plans, subscription, checkout, invoices and webhooks (ACC-03 to ACC-08).';
