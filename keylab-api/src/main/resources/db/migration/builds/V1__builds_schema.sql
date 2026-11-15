-- Flyway creates the schema "builds" and keeps its own history table in it
-- (ModuleMigrations). Tables arrive with the module's first user story.
-- No joins or foreign keys to another module's schema: refer by id only.
COMMENT ON SCHEMA builds IS 'KeyLab module builds: Builds, parts list, share image and guest import (BLD-01 to BLD-09).';
