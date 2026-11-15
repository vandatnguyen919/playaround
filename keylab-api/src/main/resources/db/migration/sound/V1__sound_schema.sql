-- Flyway creates the schema "sound" and keeps its own history table in it
-- (ModuleMigrations). Tables arrive with the module's first user story.
-- No joins or foreign keys to another module's schema: refer by id only.
COMMENT ON SCHEMA sound IS 'KeyLab module sound: Uploads, recordings, processing and the sound recipe (ADM-04/05, BLD-10).';
