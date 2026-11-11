-- Keycodes AI Research Workspace: initial schema
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE workspace_mode AS ENUM ('open_discovery', 'closed_repository');
CREATE TYPE task_status AS ENUM ('draft', 'pending_approval', 'approved', 'running', 'complete', 'failed');
CREATE TYPE source_origin AS ENUM ('openalex', 'unpaywall', 'europe_pmc', 'user_upload');
CREATE TYPE fulltext_status AS ENUM ('full_text', 'abstract_only', 'pending', 'failed');
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
CREATE TYPE answer_kind AS ENUM ('consensus', 'disagreement', 'insufficient_evidence');
CREATE TYPE verify_status AS ENUM ('verified', 'purged');

CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL,
    name        TEXT NOT NULL,
    mode        workspace_mode NOT NULL,
    summary     TEXT,                       -- AI repository summary (Mode B)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_owner ON projects(owner_id);

CREATE TABLE tasks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    brief         TEXT,
    status        task_status NOT NULL DEFAULT 'draft',
    approved_by   UUID,
    approved_at   TIMESTAMPTZ,
    -- Hash over the sorted selected source ids; locks the AI to these sources
    source_lock_hash TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_project ON tasks(project_id);

CREATE TABLE sources (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    origin         source_origin NOT NULL,
    doi            TEXT,
    title          TEXT NOT NULL,
    authors        TEXT[],
    venue          TEXT,
    year           INT,
    cited_by_count INT DEFAULT 0,
    abstract       TEXT,
    source_url     TEXT,
    pdf_url        TEXT,
    storage_key    TEXT,                    -- S3/R2 object key
    filename       TEXT,                    -- original filename (user uploads)
    fulltext       fulltext_status NOT NULL DEFAULT 'pending',
    file_sha256    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, doi)
);
CREATE INDEX idx_sources_project ON sources(project_id);
CREATE INDEX idx_sources_doi ON sources(doi);

-- Which sources a task is allowed to use
CREATE TABLE task_sources (
    task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    source_id  UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, source_id)
);

CREATE TABLE chunks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id    UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    chunk_index  INT NOT NULL,
    text         TEXT NOT NULL,
    sha256       CHAR(64) NOT NULL,          -- sha256 of text, verified on citation
    page_start   INT,
    page_end     INT,
    line_start   INT,
    line_end     INT,
    token_count  INT,
    embedding    vector(768),
    UNIQUE (source_id, chunk_index)
);
CREATE INDEX idx_chunks_source ON chunks(source_id);
CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE threads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_threads_task ON threads(task_id);

CREATE TABLE messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id    UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    role         message_role NOT NULL,
    content      TEXT NOT NULL,
    answer_kind  answer_kind,                -- assistant messages only
    model_a_raw  JSONB,                      -- Mistral output (pre-verification)
    model_b_raw  JSONB,                      -- Llama output (pre-verification)
    disagreement JSONB,                      -- both positions + conditions
    top_similarity REAL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_thread ON messages(thread_id, created_at);

CREATE TABLE citations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id    UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    chunk_id      UUID NOT NULL REFERENCES chunks(id),
    claim_text    TEXT NOT NULL,
    quoted_span   TEXT,
    status        verify_status NOT NULL,
    hash_checked  CHAR(64),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_citations_message ON citations(message_id);
CREATE INDEX idx_citations_chunk ON citations(chunk_id);
