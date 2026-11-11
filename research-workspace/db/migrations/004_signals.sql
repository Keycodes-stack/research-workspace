-- Phase 9: Signal Board. A signal is a VERIFIED claim (trend / opportunity / risk) mined from the project's sources.
CREATE TYPE signal_category AS ENUM ('trend', 'opportunity', 'risk');
CREATE TYPE signal_status   AS ENUM ('new', 'dismissed', 'merged', 'promoted');
CREATE TYPE signal_confidence AS ENUM ('high', 'medium', 'low');

CREATE TABLE signals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category     signal_category NOT NULL,
    text         TEXT NOT NULL,
    text_key     CHAR(64) NOT NULL,                 -- sha256 of the normalised text, dedupes re-scans
    status       signal_status NOT NULL DEFAULT 'new',
    confidence   signal_confidence NOT NULL,
    models_agree BOOLEAN NOT NULL DEFAULT false,
    source_count INT NOT NULL DEFAULT 1,
    merged_into  UUID REFERENCES signals(id),
    status_reason TEXT,
    decided_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, category, text_key)
);
CREATE INDEX idx_signals_project ON signals(project_id, category, status);

CREATE TABLE signal_evidence (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id   UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    chunk_id    UUID NOT NULL REFERENCES chunks(id),
    quote       TEXT NOT NULL,
    sha256      CHAR(64) NOT NULL,                  -- chunk hash the quote was verified against
    model       TEXT NOT NULL,                      -- model_a | model_b
    match_kind  TEXT,
    UNIQUE (signal_id, chunk_id, quote, model)
);
CREATE INDEX idx_signal_evidence_signal ON signal_evidence(signal_id);
