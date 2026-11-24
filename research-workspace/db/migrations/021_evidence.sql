-- Evidence library: each research work package is researched automatically (papers -> top 10 -> both models
-- -> judge). One run per work package (the latest); its evidence items are replaced on every run.
-- Additive only.

CREATE TABLE IF NOT EXISTS evidence_runs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id           UUID NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'complete', 'failed', 'waiting')),
    question          TEXT NOT NULL DEFAULT '',
    statement         TEXT,
    papers_read       INT NOT NULL DEFAULT 0,
    models            JSONB NOT NULL DEFAULT '{}',
    error             TEXT,
    requested_by      UUID,
    references_added  BOOLEAN NOT NULL DEFAULT false,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS evidence_runs_project_idx ON evidence_runs(project_id);

CREATE TABLE IF NOT EXISTS evidence_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id       UUID NOT NULL REFERENCES evidence_runs(id) ON DELETE CASCADE,
    task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    seq          INT NOT NULL,                        -- shown as "Evidence 001", numbered per project
    claim_text   TEXT NOT NULL,
    quote        TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL CHECK (status IN ('verified', 'pending')),
    found_by     TEXT[] NOT NULL DEFAULT '{}',        -- 'model_a' / 'model_b' that verified the claim
    confirmed    BOOLEAN NOT NULL DEFAULT false,      -- both models or the judge agree
    chunk_ids    UUID[] NOT NULL DEFAULT '{}',
    source_id    UUID REFERENCES sources(id) ON DELETE SET NULL,
    source_title TEXT,
    doi          TEXT,
    source_url   TEXT,
    origin       TEXT,
    pub_year     INT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_items_project_idx ON evidence_items(project_id, seq);
CREATE INDEX IF NOT EXISTS evidence_items_task_idx ON evidence_items(task_id);
