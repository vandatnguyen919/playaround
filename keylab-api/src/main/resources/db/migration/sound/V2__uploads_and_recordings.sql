-- US-38 (ADM-04, ADM-05): uploads and recordings. Switches belong to catalog,
-- so switch_id is a plain id with no foreign key (modulith-plan.md, rule 1).

-- One presigned upload: the ticket (ADM-04 POST /v1/admin/uploads), then the
-- file itself (PUT to the signed URL), then its use, once: a recording takes a
-- sound upload, a switch takes a photo upload.
CREATE TABLE uploads
(
  id           UUID PRIMARY KEY,
  purpose      TEXT NOT NULL CHECK (purpose IN ('sound', 'switch_photo')),
  content_type TEXT NOT NULL,
  file_name    TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'used')),
  -- Set when the file arrives.
  size_bytes   BIGINT,
  sha256       TEXT CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL,
  expires_at   TIMESTAMP WITH TIME ZONE NOT NULL,
  received_at  TIMESTAMP WITH TIME ZONE
);

-- One take of one stroke of one variant. A slot (switch, variant, stroke) can
-- hold several takes; the newest ready one is what plays (catalog keeps it).
CREATE TABLE recordings
(
  id             UUID PRIMARY KEY,
  switch_id      UUID NOT NULL,
  variant        TEXT NOT NULL CHECK (variant IN ('stock', 'lubed', 'foam')),
  stroke         TEXT NOT NULL CHECK (stroke IN ('press', 'release')),
  upload_id      UUID NOT NULL UNIQUE REFERENCES uploads (id),
  file_name      TEXT,
  status         TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  -- Set once ready: content-addressed URL, length, integrated loudness and
  -- waveform peaks (0 to 1), so nobody decodes audio to draw it.
  url            TEXT,
  sha256         TEXT,
  duration_ms    INTEGER,
  loudness_lufs  NUMERIC(5, 1),
  peaks          JSONB,
  -- Set when failed: why, in words the editor can act on.
  error          TEXT,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL,
  processed_at   TIMESTAMP WITH TIME ZONE,
  CHECK (status <> 'ready' OR (url IS NOT NULL AND duration_ms IS NOT NULL AND peaks IS NOT NULL))
);

-- ADM-05 lists newest first, by status or by switch.
CREATE INDEX recordings_created_idx ON recordings (created_at DESC, id DESC);
CREATE INDEX recordings_switch_idx ON recordings (switch_id, created_at DESC, id DESC);
CREATE INDEX recordings_status_idx ON recordings (status, created_at DESC, id DESC);
