-- A work package document written by the AI at project creation. The Workspace shows it as "AI suggested";
-- the flag is cleared when someone saves their own version.
ALTER TABLE work_package_documents ADD COLUMN IF NOT EXISTS ai_drafted BOOLEAN NOT NULL DEFAULT false;
