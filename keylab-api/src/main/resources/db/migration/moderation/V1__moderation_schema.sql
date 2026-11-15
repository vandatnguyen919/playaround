-- Flyway creates the schema "moderation" and keeps its own history table in it
-- (ModuleMigrations). Tables arrive with the module's first user story.
-- No joins or foreign keys to another module's schema: refer by id only.
COMMENT ON SCHEMA moderation IS 'KeyLab module moderation: Moderation queue, decisions and featured slots (ADM-09/10).';
