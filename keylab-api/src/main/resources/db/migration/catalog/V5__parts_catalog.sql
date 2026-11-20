-- KL2-1 (CAT-05 to CAT-08): the parts the builder picks besides the switch,
-- with a starter set seeded from the design screens (AdminCatalog,
-- ModsDesktop, CaseDesktop). The editors' screen for these is US-40 (ADM-07);
-- until then this seed is the whole catalog. Seed rows carry is_seed = true so
-- US-40 can tell them apart, edit them and retire them like any other row.
--
-- Rows are never deleted once a build may use them: keycap sets are hidden,
-- mods switched off (live = false), case parts retired (is_active = false).
-- The public endpoints return only published sets, live mods and active case
-- parts. position is the order the screens list them in.

-- CAT-05, CAT-06. A set is a material, a profile and a colourway; the API
-- addresses it by slug and returns its uuid, like a switch.
CREATE TABLE keycap_sets
(
  id          UUID PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  material    TEXT NOT NULL CHECK (material IN ('pbt', 'abs', 'pom')),
  profile     TEXT NOT NULL CHECK (profile IN ('cherry', 'oem', 'sa', 'xda')),
  base_hex    TEXT NOT NULL CHECK (base_hex ~ '^#[0-9A-F]{6}$'),
  alpha_hex   TEXT NOT NULL CHECK (alpha_hex ~ '^#[0-9A-F]{6}$'),
  mod_hex     TEXT NOT NULL CHECK (mod_hex ~ '^#[0-9A-F]{6}$'),
  accent_hex  TEXT NOT NULL CHECK (accent_hex ~ '^#[0-9A-F]{6}$'),
  -- -1 deeper ... +1 brighter, relative to stock PBT Cherry.
  sound_shift NUMERIC(3, 2) NOT NULL DEFAULT 0 CHECK (sound_shift BETWEEN -1 AND 1),
  key_count   INTEGER NOT NULL CHECK (key_count > 0),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'hidden')),
  position    SMALLINT NOT NULL DEFAULT 0,
  is_seed     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX keycap_sets_published_idx ON keycap_sets (position, id) WHERE status = 'published';

-- CAT-07. A toggle mod is on or off; a level mod offers named levels, the
-- first being "off" (lube: none, light, heavy). sound_fx holds the four
-- sliders of the AdminCatalog screen, -3 to +3 each:
-- { "pitch": -1, "thock": 1, "volume": -1, "rattle": -1 }.
-- impact is the short line on the builder's mod card ("smoother · deeper").
CREATE TABLE mods
(
  id          UUID PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  impact      TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('toggle', 'level')),
  levels      TEXT[],
  sound_fx    JSONB NOT NULL,
  live        BOOLEAN NOT NULL DEFAULT false,
  position    SMALLINT NOT NULL DEFAULT 0,
  is_seed     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT mods_levels_match_kind CHECK (
    (kind = 'level' AND cardinality(levels) >= 2) OR (kind = 'toggle' AND levels IS NULL))
);

CREATE INDEX mods_live_idx ON mods (position, id) WHERE live;

-- CAT-08. Case materials, plates and mounts, addressed by short text ids.
-- sound_fx holds the factors the builder's recipe applies (pitch, decay and
-- thump multiply; bright adds); note is the line under each pick.
CREATE TABLE case_materials
(
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  note       TEXT NOT NULL,
  -- The case colours offered with this material, as #RRGGBB.
  colors     TEXT[] NOT NULL CHECK (array_to_string(colors, ',') ~ '^#[0-9A-F]{6}(,#[0-9A-F]{6})*$'),
  sound_fx   JSONB NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  position   SMALLINT NOT NULL DEFAULT 0,
  is_seed    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE plates
(
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  note       TEXT NOT NULL,
  -- 0 stiff ... 4 the most flexible.
  flex       SMALLINT NOT NULL CHECK (flex BETWEEN 0 AND 4),
  sound_fx   JSONB NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  position   SMALLINT NOT NULL DEFAULT 0,
  is_seed    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE mounts
(
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  note       TEXT NOT NULL,
  sound_fx   JSONB NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  position   SMALLINT NOT NULL DEFAULT 0,
  is_seed    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Seed: keycap sets from AdminCatalog. The screen draws the shift on a -4..+4
-- scale (50% + 12% a step); the API's -1..+1 is that step / 4. Fixed ids, so
-- every database holds the same rows.
INSERT INTO keycap_sets (id, slug, name, material, profile, base_hex, alpha_hex, mod_hex, accent_hex,
                         sound_shift, key_count, status, position, is_seed)
VALUES ('0193a8c0-0000-7000-8000-000000000101', 'cream-paper', 'Cream Paper', 'pbt', 'cherry',
        '#FFFDF5', '#FFFDF5', '#2C2A5A', '#F16B53', -0.25, 104, 'published', 1, true),
       ('0193a8c0-0000-7000-8000-000000000102', 'navy-sun', 'Navy Sun', 'pbt', 'cherry',
        '#2C2A5A', '#FFFDF5', '#2C2A5A', '#FFD24D', -0.25, 104, 'published', 2, true),
       ('0193a8c0-0000-7000-8000-000000000103', 'sky-lab', 'Sky Lab', 'abs', 'oem',
        '#99D6FF', '#FFFDF5', '#99D6FF', '#C6F079', 0.50, 104, 'published', 3, true),
       ('0193a8c0-0000-7000-8000-000000000104', 'lime-pop', 'Lime Pop', 'abs', 'sa',
        '#C6F079', '#FFFDF5', '#C6F079', '#F16B53', -0.50, 104, 'draft', 4, true),
       ('0193a8c0-0000-7000-8000-000000000105', 'coral-reef', 'Coral Reef', 'pbt', 'xda',
        '#F16B53', '#FFF1C7', '#F16B53', '#2C2A5A', 0.00, 104, 'published', 5, true),
       ('0193a8c0-0000-7000-8000-000000000106', 'ink-blank', 'Ink Blank', 'pom', 'cherry',
        '#1E1C3F', '#2C2A5A', '#1E1C3F', '#FFD24D', -0.75, 104, 'hidden', 6, true);

-- Seed: the builder's six mods (ModsDesktop: names, levels, copy) with the
-- AdminCatalog slider values of the matching row (Lube = "Lubed switches",
-- Stabilizer tuning = "Lubed stabs"). O-rings and Spring swap have no
-- AdminCatalog row; their values follow ModsDesktop's sound model (O-rings:
-- pitch x0.88, volume x0.7; spring swap changes pitch by 3 to 4 %, under one
-- step). Holee mod is AdminCatalog's switched-off mod: not offered to builders.
INSERT INTO mods (id, slug, name, description, impact, kind, levels, sound_fx, live, position, is_seed)
VALUES ('0193a8c0-0000-7000-8000-000000000201', 'lube', 'Lube',
        'Lubing stems and springs smooths the stroke and rounds off scratchy, high-pitched noise.',
        'smoother · deeper', 'level', ARRAY ['none', 'light', 'heavy'],
        '{"pitch": -1, "thock": 1, "volume": -1, "rattle": -1}', true, 1, true),
       ('0193a8c0-0000-7000-8000-000000000202', 'case-foam', 'Case foam',
        'Fills the hollow under the PCB. Cuts ping and echo for a tighter, deeper sound.',
        'deeper · less echo', 'toggle', NULL,
        '{"pitch": 0, "thock": 1, "volume": -2, "rattle": -2}', true, 2, true),
       ('0193a8c0-0000-7000-8000-000000000203', 'pe-foam', 'PE foam / tape mod',
        'A thin layer between PCB and switches. Makes the sound poppier and more marbly.',
        'poppier · brighter', 'toggle', NULL,
        '{"pitch": 1, "thock": 1, "volume": 0, "rattle": -1}', true, 3, true),
       ('0193a8c0-0000-7000-8000-000000000204', 'stabs', 'Stabilizer tuning',
        'Clipped, lubed stabilizers stop rattle on the spacebar, shift and enter.',
        'no rattle', 'toggle', NULL,
        '{"pitch": 0, "thock": 0, "volume": -1, "rattle": -3}', true, 4, true),
       ('0193a8c0-0000-7000-8000-000000000205', 'o-rings', 'O-rings',
        'Rubber rings under the keycaps shorten travel and soften the bottom-out.',
        'quieter · shorter', 'toggle', NULL,
        '{"pitch": -1, "thock": 0, "volume": -2, "rattle": 0}', true, 5, true),
       ('0193a8c0-0000-7000-8000-000000000206', 'spring-swap', 'Spring swap',
        'Change the weight of every press. Lighter is faster; heavier gives a fuller return.',
        'feel · weight', 'level', ARRAY ['stock', 'lighter', 'heavier'],
        '{"pitch": 0, "thock": 0, "volume": 0, "rattle": 0}', true, 6, true),
       ('0193a8c0-0000-7000-8000-000000000207', 'holee-mod', 'Holee mod',
        'Bandaid strip on the stabilizer stem.',
        'less rattle', 'toggle', NULL,
        '{"pitch": 0, "thock": 0, "volume": 0, "rattle": -2}', false, 7, true);

-- Seed: CaseDesktop. Every material offers the screen's eight case colours.
INSERT INTO case_materials (id, name, note, colors, sound_fx, position, is_seed)
VALUES ('alu', 'Aluminum', 'Dense and solid. Clean, low resonance.',
        ARRAY ['#C3C9D4', '#2B4677', '#2C2A5A', '#FFD24D', '#1C1F26', '#E6DFCC', '#F16B53', '#6B4A33'],
        '{"pitch": 1, "bright": 0, "decay": 1.1, "thump": 1}', 1, true),
       ('pc', 'Polycarbonate', 'Frosted, light-friendly. Softer, brighter.',
        ARRAY ['#C3C9D4', '#2B4677', '#2C2A5A', '#FFD24D', '#1C1F26', '#E6DFCC', '#F16B53', '#6B4A33'],
        '{"pitch": 1.08, "bright": 0.08, "decay": 0.95, "thump": 0.95}', 2, true),
       ('plastic', 'Plastic', 'Light and cheap. Hollow without foam.',
        ARRAY ['#C3C9D4', '#2B4677', '#2C2A5A', '#FFD24D', '#1C1F26', '#E6DFCC', '#F16B53', '#6B4A33'],
        '{"pitch": 1.12, "bright": 0.05, "decay": 1.2, "thump": 0.85}', 3, true),
       ('wood', 'Wood', 'Warm and muted. Softens the high end.',
        ARRAY ['#C3C9D4', '#2B4677', '#2C2A5A', '#FFD24D', '#1C1F26', '#E6DFCC', '#F16B53', '#6B4A33'],
        '{"pitch": 0.9, "bright": -0.08, "decay": 0.85, "thump": 1.1}', 4, true);

INSERT INTO plates (id, name, note, flex, sound_fx, position, is_seed)
VALUES ('alu', 'Alu', 'Stiff and balanced, the safe middle ground.', 1,
        '{"pitch": 1, "bright": 0, "thump": 1}', 1, true),
       ('brass', 'Brass', 'Heavy and stiff. Bright, sharp and loud.', 0,
        '{"pitch": 1.12, "bright": 0.1, "thump": 0.9}', 2, true),
       ('fr4', 'FR4', 'Slight flex, slightly deeper than aluminum.', 2,
        '{"pitch": 0.97, "bright": -0.02, "thump": 1}', 3, true),
       ('pc', 'PC', 'Flexible and soft. Deep, muted thock.', 3,
        '{"pitch": 0.86, "bright": -0.1, "thump": 1.1}', 4, true),
       ('pom', 'POM', 'The most flexible. Creamy and low.', 4,
        '{"pitch": 0.82, "bright": -0.12, "thump": 1.15}', 5, true);

INSERT INTO mounts (id, name, note, sound_fx, position, is_seed)
VALUES ('tray', 'Tray', 'Firm, simple. Some ping.', '{"pitch": 1.05, "decay": 1.1, "thump": 1}', 1, true),
       ('gasket', 'Gasket', 'Soft, bouncy, even.', '{"pitch": 0.92, "decay": 0.85, "thump": 1.05}', 2, true),
       ('top-mount', 'Top mount', 'Balanced, consistent.', '{"pitch": 1, "decay": 1, "thump": 1}', 3, true);
