-- Phase 13: live collaboration on concepts. Presence and locks are advisory and expire on their own.
CREATE TYPE comment_stance AS ENUM ('support', 'challenge', 'question', 'note');

CREATE TABLE concept_comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concept_id  UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    section_key TEXT CHECK (section_key IS NULL OR section_key IN ('problem','hypothesis','approach','risks','next_steps','evidence','scoring')),
    parent_id   UUID REFERENCES concept_comments(id) ON DELETE CASCADE,
    author      UUID NOT NULL,
    stance      comment_stance NOT NULL,
    body        TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
    resolved    BOOLEAN NOT NULL DEFAULT false,
    resolved_by UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_concept ON concept_comments(concept_id, created_at);

CREATE TABLE concept_presence (
    concept_id  UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL,
    section_key TEXT,
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (concept_id, user_id)
);

CREATE TABLE section_locks (
    concept_id  UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    section_key TEXT NOT NULL,
    user_id     UUID NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (concept_id, section_key)
);
