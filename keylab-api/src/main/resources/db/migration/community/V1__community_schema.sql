-- Flyway creates the schema "community" and keeps its own history table in it
-- (ModuleMigrations). Tables arrive with the module's first user story.
-- No joins or foreign keys to another module's schema: refer by id only.
COMMENT ON SCHEMA community IS 'KeyLab module community: Profiles, follows, likes, collections, activity, badges and reports (ME, SOC).';
