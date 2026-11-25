-- A Home chat is saved to the project as one work package. This records which one, so each chat makes exactly one.
-- Additive only.

ALTER TABLE threads ADD COLUMN IF NOT EXISTS work_package_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
