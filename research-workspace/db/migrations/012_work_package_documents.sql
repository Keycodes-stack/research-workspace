-- Each research work package (task) has one working document, the "Workspace" page of the project.
-- Plain text only: the editor stores what the user typed; the page renders it as text, never as HTML.
CREATE TABLE IF NOT EXISTS work_package_documents (
    task_id     UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    body        TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 200000),
    version     INT NOT NULL DEFAULT 0,
    updated_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
