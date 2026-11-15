-- US-37 (ADM-02): switches, written by the KeyLab team. A new switch starts as
-- a draft; only publishing (ADM-03, US-39) makes it "published", and the
-- public library (CAT-01) reads published rows only.
CREATE TABLE switches
(
  id           UUID PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  brand        TEXT,
  type         TEXT NOT NULL CHECK (type IN ('linear', 'tactile', 'clicky', 'silent')),
  profile      TEXT CHECK (profile IN ('deep', 'poppy', 'clacky', 'muted')),
  stem_color   TEXT CHECK (stem_color ~ '^#[0-9A-Fa-f]{6}$'),
  force_g      NUMERIC(5, 1),
  actuation_mm NUMERIC(3, 2),
  travel_mm    NUMERIC(3, 2),
  bottom_out_g NUMERIC(5, 1),
  spring       TEXT,
  housing      TEXT,
  -- [{ "travelMm": 0.4, "forceG": 38, "stroke": "press" }, ...], sorted by
  -- stroke then travel. Drawn as a whole and never queried point by point.
  force_curve  JSONB NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'hidden')),
  sound_status TEXT NOT NULL DEFAULT 'missing' CHECK (sound_status IN ('recorded', 'missing', 'processing')),
  new_until    TIMESTAMP WITH TIME ZONE,
  published_at TIMESTAMP WITH TIME ZONE,
  -- Row version: the ETag, checked against If-Match on PATCH and DELETE.
  version      BIGINT NOT NULL DEFAULT 1,
  created_by   TEXT NOT NULL,
  updated_by   TEXT NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- The admin list (US-36) and the public library (CAT-01) both filter on status.
CREATE INDEX switches_status_idx ON switches (status, created_at DESC, id DESC);
