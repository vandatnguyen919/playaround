-- Flyway creates the schema "catalog" and keeps its own history table in it
-- (ModuleMigrations). Tables arrive with the module's first user story.
-- No joins or foreign keys to another module's schema: refer by id only.
COMMENT ON SCHEMA catalog IS 'KeyLab module catalog: Switches, keycap sets, mods, case options and publishing (CAT, ADM-02/03/06/07).';
