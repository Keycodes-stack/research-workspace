-- Project code shown in the directory (reference: P-010, P-011 ...), assigned in creation order.
CREATE SEQUENCE IF NOT EXISTS project_code_seq;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS code TEXT UNIQUE;
WITH numbered AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM projects WHERE code IS NULL
)
UPDATE projects p SET code = 'P-' || lpad(numbered.n::text, 3, '0')
FROM numbered WHERE p.id = numbered.id;
SELECT setval('project_code_seq', GREATEST((SELECT count(*) FROM projects), 1));
ALTER TABLE projects ALTER COLUMN code SET DEFAULT 'P-' || lpad(nextval('project_code_seq')::text, 3, '0');

-- Work package documents can be plain text (earlier) or structured rich text from the editor ('tiptap', JSON).
ALTER TABLE work_package_documents
    ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'plain' CHECK (format IN ('plain', 'tiptap'));

-- Comments on a work package document. Resolved comments stay, so the discussion can be reviewed.
CREATE TABLE IF NOT EXISTS work_package_comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author      UUID NOT NULL,
    body        TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
    resolved    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_package_comments_task_idx ON work_package_comments(task_id, created_at);
