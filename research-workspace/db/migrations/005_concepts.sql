-- Phase 10: Concept Builder, scoring rubric, department lenses.
CREATE TYPE concept_status AS ENUM ('draft', 'active', 'archived');

CREATE TABLE concepts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    status      concept_status NOT NULL DEFAULT 'draft',
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_concepts_project ON concepts(project_id);

CREATE TABLE concept_signals (
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    signal_id  UUID NOT NULL REFERENCES signals(id),
    PRIMARY KEY (concept_id, signal_id)
);

-- Brief sections are AUTHOR-WRITTEN text (never model-written). Versioned for safe concurrent editing.
CREATE TABLE concept_sections (
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    key        TEXT NOT NULL CHECK (key IN ('problem', 'hypothesis', 'approach', 'risks', 'next_steps')),
    body       TEXT NOT NULL DEFAULT '',
    version    INT NOT NULL DEFAULT 0,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (concept_id, key)
);

-- Verified evidence copied from the concept's signals (quote + sealed hash).
CREATE TABLE concept_evidence (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    signal_id  UUID REFERENCES signals(id),
    claim_text TEXT NOT NULL,
    chunk_id   UUID NOT NULL REFERENCES chunks(id),
    quote      TEXT NOT NULL,
    sha256     CHAR(64) NOT NULL,
    model      TEXT NOT NULL,
    UNIQUE (concept_id, signal_id, chunk_id, quote, model)
);

CREATE TABLE concept_scores (
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    criterion  TEXT NOT NULL CHECK (criterion IN ('novelty', 'feasibility', 'impact', 'evidence_strength')),
    scorer     UUID NOT NULL,
    score      INT NOT NULL CHECK (score BETWEEN 1 AND 5),
    note       TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (concept_id, criterion, scorer)
);

-- Department lenses: verified statements only. Regenerating a department replaces its rows.
CREATE TABLE lens_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    department TEXT NOT NULL CHECK (department IN ('rnd', 'finance', 'marketing', 'legal')),
    text       TEXT NOT NULL,
    chunk_id   UUID NOT NULL REFERENCES chunks(id),
    quote      TEXT NOT NULL,
    sha256     CHAR(64) NOT NULL,
    model      TEXT NOT NULL,
    match_kind TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lens_items ON lens_items(concept_id, department);
CREATE TABLE lens_runs (
    concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    department TEXT NOT NULL,
    status     TEXT NOT NULL,          -- ok | no_evidence | below_similarity_threshold
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (concept_id, department)
);
