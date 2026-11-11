-- Phase 11: Innovation Pipeline (stage gates) + append-only decision log.
CREATE TYPE pipeline_stage AS ENUM ('ideation', 'evaluation', 'validation', 'pilot', 'launched', 'parked', 'rejected');
ALTER TABLE concepts ADD COLUMN stage pipeline_stage NOT NULL DEFAULT 'ideation';

CREATE TABLE pipeline_decisions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concept_id   UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    action       TEXT NOT NULL CHECK (action IN ('advance', 'park', 'reject', 'reopen')),
    from_stage   pipeline_stage NOT NULL,
    to_stage     pipeline_stage NOT NULL,
    reason       TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
    override     BOOLEAN NOT NULL DEFAULT false,      -- gates failed and the decider overrode them
    gates        JSONB NOT NULL,                      -- gate results at the moment of decision
    decided_by   UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_decisions_concept ON pipeline_decisions(concept_id, created_at);

CREATE FUNCTION pipeline_decisions_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'pipeline decisions are append-only';
END;
$$ LANGUAGE plpgsql;
-- BEFORE UPDATE/DELETE row triggers; ON DELETE CASCADE from a deleted concept is the only way rows leave.
CREATE TRIGGER trg_decisions_no_update BEFORE UPDATE ON pipeline_decisions
    FOR EACH ROW EXECUTE FUNCTION pipeline_decisions_append_only();
CREATE TRIGGER trg_decisions_no_delete BEFORE DELETE ON pipeline_decisions
    FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION pipeline_decisions_append_only();
