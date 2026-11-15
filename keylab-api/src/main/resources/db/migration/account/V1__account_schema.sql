-- Flyway creates the schema "account" and keeps its own history table in it
-- (ModuleMigrations). Tables arrive with the module's first user story.
-- No joins or foreign keys to another module's schema: refer by id only.
COMMENT ON SCHEMA account IS 'KeyLab module account: Settings, identities, export, deletion and admin user actions (ACC-01/02/09/10, ADM-08).';
