-- US-39: catalog's own copy of the ready recordings, fed by the sound
-- module's SoundProcessed event (catalog/events/SoundStatusListener). Sound
-- owns uploads and processing; catalog keeps what the public library and the
-- publish check need, so neither reads the other's schema.
CREATE TABLE switch_recordings
(
  switch_id     UUID NOT NULL REFERENCES switches (id) ON DELETE CASCADE,
  variant       TEXT NOT NULL CHECK (variant IN ('stock', 'lubed', 'foam')),
  stroke        TEXT NOT NULL CHECK (stroke IN ('press', 'release')),
  recording_id  UUID NOT NULL,
  url           TEXT NOT NULL,
  duration_ms   INT,
  loudness_lufs NUMERIC(5, 2),
  -- Waveform peaks, 0 to 1, drawn as a whole.
  peaks         JSONB NOT NULL DEFAULT '[]',
  processed_at  TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY (switch_id, variant, stroke)
);

-- The public library filters and sorts published rows.
CREATE INDEX switches_published_idx ON switches (published_at DESC, id DESC) WHERE status = 'published';
