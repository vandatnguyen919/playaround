-- Infrastructure tables that belong to no module. A module that is split out
-- into its own service takes its own copy of this schema.

-- Idempotency-Key replays (shared/idempotency/IdempotencyKeys). A row with a
-- null status_code is a request still running.
CREATE TABLE idempotency_keys
(
  scope         TEXT NOT NULL,
  key           TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 64),
  request_hash  TEXT NOT NULL,
  status_code   INT,
  location      TEXT,
  response_body TEXT,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  expires_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);

-- Spring Modulith's event publication registry (the outbox), as in
-- spring-modulith-events-jdbc 2.1.0 schemas/v2/schema-postgresql.sql.
CREATE TABLE event_publication
(
  id                     UUID NOT NULL,
  listener_id            TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  serialized_event       TEXT NOT NULL,
  publication_date       TIMESTAMP WITH TIME ZONE NOT NULL,
  completion_date        TIMESTAMP WITH TIME ZONE,
  status                 TEXT,
  completion_attempts    INT,
  last_resubmission_date TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (id)
);
CREATE INDEX event_publication_serialized_event_hash_idx ON event_publication USING hash(serialized_event);
CREATE INDEX event_publication_by_completion_date_idx ON event_publication (completion_date);
