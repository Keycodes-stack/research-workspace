-- Images attached to a project (the wizard's "Attach image", and images added later on the project).
-- The file itself is in object storage under storage_key; this row holds its metadata.
CREATE TABLE IF NOT EXISTS project_attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    uploaded_by  UUID NOT NULL,
    filename     TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
    content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
    size_bytes   INT NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    storage_key  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_attachments_project_idx ON project_attachments(project_id, created_at);
