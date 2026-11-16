-- A project is the parent of its chats: project -> chat task -> threads -> messages.
-- Chats are stored on the server so they appear in every browser and session that can open the project.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';     -- sector, lead, question, method...
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'research'
    CHECK (kind IN ('research', 'chat'));
-- Chats created by the earlier bridge lived under a task titled "Halden chat".
UPDATE tasks SET kind = 'chat' WHERE title = 'Halden chat' AND kind = 'research';
CREATE INDEX IF NOT EXISTS tasks_project_kind_idx ON tasks (project_id, kind);
