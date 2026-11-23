-- US-08: saved builds (BLD-01, BLD-02, BLD-04), database-design.md "Builds".
-- A build is the thing in My builds; each save of new parts adds one
-- immutable version. Catalog parts are kept by their public slug or id, with
-- no foreign key into the catalog schema (modulith-plan.md, rule 1): the
-- catalog never deletes a part a build may use.
CREATE TABLE builds
(
  id                 UUID PRIMARY KEY,
  -- The Keycloak sub of the member who saved it.
  owner_id           UUID NOT NULL,
  name               TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  visibility         TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  current_version_id UUID,
  -- Unsaved edits (autosave). No endpoint writes it yet.
  draft              JSONB,
  remixed_from       UUID REFERENCES builds (id),
  thumb_key          TEXT,
  like_count         INT NOT NULL DEFAULT 0,
  -- Row version: the ETag. Moves on every change, rename included.
  version            BIGINT NOT NULL DEFAULT 1,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMP WITH TIME ZONE
);

-- My builds, newest first (BLD-01).
CREATE INDEX builds_owner_updated_idx ON builds (owner_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX builds_owner_created_idx ON builds (owner_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE build_versions
(
  id              UUID PRIMARY KEY,
  build_id        UUID NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  version_no      INT NOT NULL CHECK (version_no >= 1),
  layout          TEXT NOT NULL CHECK (layout IN ('60', '65', '75', 'tkl', 'full')),
  switch_slug     TEXT NOT NULL,
  switch_variant  TEXT NOT NULL CHECK (switch_variant IN ('stock', 'lubed', 'foam')),
  keycap_set      TEXT,
  -- The set's profile and material when this version was saved.
  keycap_profile  TEXT,
  keycap_material TEXT,
  case_material   TEXT,
  case_color_hex  TEXT CHECK (case_color_hex ~ '^#[0-9A-F]{6}$'),
  plate           TEXT,
  mount           TEXT,
  desk_pad        TEXT,
  -- Everything needed to redraw and hear it; today the recipe's filters and
  -- meter under "sound".
  config          JSONB NOT NULL,
  schema_version  SMALLINT NOT NULL DEFAULT 1,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (build_id, version_no)
);

ALTER TABLE builds
  ADD CONSTRAINT builds_current_version_fk FOREIGN KEY (current_version_id) REFERENCES build_versions (id);

CREATE TABLE build_version_mods
(
  version_id UUID NOT NULL REFERENCES build_versions (id) ON DELETE CASCADE,
  mod_slug   TEXT NOT NULL,
  -- The level's name ("light"); null for a toggle mod.
  level      TEXT,
  -- The order the member added them in.
  position   SMALLINT NOT NULL,
  PRIMARY KEY (version_id, mod_slug)
);
CREATE INDEX build_version_mods_mod_idx ON build_version_mods (mod_slug);
