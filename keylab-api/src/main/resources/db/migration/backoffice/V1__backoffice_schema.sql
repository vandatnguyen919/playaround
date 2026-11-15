-- Flyway creates the schema "backoffice" and keeps its own history table in it
-- (ModuleMigrations). Tables arrive with the module's first user story.
-- No joins or foreign keys to another module's schema: refer by id only.
COMMENT ON SCHEMA backoffice IS 'KeyLab module backoffice: Team roles, app settings, audit log and overview metrics (ADM-01, ADM-11 to ADM-13).';
