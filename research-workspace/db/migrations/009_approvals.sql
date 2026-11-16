-- Approval chain: researcher requests review -> each named VP reviews (approve / request changes, with remarks)
-- -> once every VP approved, the CEO (optional) signs off. A request is a "round"; changes requested start a new round.
CREATE TABLE concept_approvals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concept_id   UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    round        INT  NOT NULL CHECK (round >= 1),
    stage        TEXT NOT NULL CHECK (stage IN ('vp', 'ceo')),
    reviewer_id  UUID NOT NULL,
    decision     TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'changes_requested')),
    remarks      TEXT,
    requested_by UUID NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at   TIMESTAMPTZ,
    UNIQUE (concept_id, round, reviewer_id),
    CHECK (decision <> 'changes_requested' OR length(trim(coalesce(remarks, ''))) >= 10)
);
CREATE INDEX idx_approvals_concept ON concept_approvals(concept_id, round);
CREATE INDEX idx_approvals_reviewer ON concept_approvals(reviewer_id, decision);
