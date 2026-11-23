-- People directory (the Organization & Access list). Sponsors, project leads and core team members are chosen
-- from it in the wizard. A person can later be linked to a sign-in account (not yet done).
CREATE TABLE IF NOT EXISTS people (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name   TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
    email       TEXT CHECK (email IS NULL OR (length(email) <= 254 AND email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
    department  TEXT CHECK (department IS NULL OR length(department) <= 120),
    job_title   TEXT CHECK (job_title IS NULL OR length(job_title) <= 120),
    active      BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one active person per name, and one person per email address
CREATE UNIQUE INDEX IF NOT EXISTS people_active_name_uniq ON people (lower(btrim(full_name))) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS people_email_uniq ON people (lower(email)) WHERE email IS NOT NULL;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS executive_sponsor_id UUID REFERENCES people(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS project_lead_id UUID REFERENCES people(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS core_team_ids JSONB NOT NULL DEFAULT '[]';
