-- Projects module, per "Projects Module & Creation Wizard Implementation Specification", section 5.
-- Additive only: existing rows keep their data, and the new columns get the spec defaults.
-- Allowed values are fixed by CHECK constraints so the database rejects anything the wizard does not offer.

-- ---- projects -------------------------------------------------------------------------
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS project_type TEXT CHECK (project_type IN (
        'Commercial Assessment', 'Technical Feasibility', 'Experimental Research',
        'Literature Review', 'Comparative Technology Assessment')),
    ADD COLUMN IF NOT EXISTS governance_level TEXT NOT NULL DEFAULT 'Standard'
        CHECK (governance_level IN ('Standard', 'Strict / Regulated', 'Lightweight')),
    ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'High'
        CHECK (priority IN ('High', 'Medium', 'Low')),
    -- "Draft" is what Save Draft persists (spec 3.7); the others are the directory statuses (spec 2.1).
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Active'
        CHECK (status IN ('Draft', 'Active', 'In Progress', 'Pending Approval', 'Completed', 'Parked')),
    ADD COLUMN IF NOT EXISTS governance_stage TEXT NOT NULL DEFAULT 'Discovery'
        CHECK (governance_stage IN ('Discovery', 'Validation', 'Business Case', 'Decided')),
    ADD COLUMN IF NOT EXISTS programme TEXT,
    ADD COLUMN IF NOT EXISTS business_unit TEXT,
    ADD COLUMN IF NOT EXISTS business_objective TEXT,
    ADD COLUMN IF NOT EXISTS business_case TEXT,
    ADD COLUMN IF NOT EXISTS expected_outcome TEXT,
    ADD COLUMN IF NOT EXISTS in_scope JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS out_of_scope JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS success_measures JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS assumptions TEXT,
    ADD COLUMN IF NOT EXISTS external_dependencies TEXT,
    ADD COLUMN IF NOT EXISTS start_date DATE,
    ADD COLUMN IF NOT EXISTS target_date DATE,
    ADD COLUMN IF NOT EXISTS budget_indicative NUMERIC(15, 2) CHECK (budget_indicative IS NULL OR budget_indicative >= 0),
    -- ISO 4217 code. The spec asks for a currency selector but names no list; any 3-letter code is accepted.
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    ADD COLUMN IF NOT EXISTS cost_centre TEXT,
    ADD COLUMN IF NOT EXISTS delivery_approach TEXT CHECK (delivery_approach IN ('Stage-Gate', 'Agile / Sprints', 'Hybrid')),
    ADD COLUMN IF NOT EXISTS reporting_frequency TEXT CHECK (reporting_frequency IN ('Weekly', 'Bi-weekly', 'Monthly')),
    ADD COLUMN IF NOT EXISTS resource_allocation TEXT,
    ADD COLUMN IF NOT EXISTS risk_assessment TEXT,
    ADD COLUMN IF NOT EXISTS executive_sponsor TEXT,
    ADD COLUMN IF NOT EXISTS project_lead TEXT,
    ADD COLUMN IF NOT EXISTS stakeholder_notes TEXT,
    ADD COLUMN IF NOT EXISTS departments JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS core_team JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS external_organizations JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS standards JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS quality_lead TEXT,
    ADD COLUMN IF NOT EXISTS security_classification TEXT NOT NULL DEFAULT 'Confidential'
        CHECK (security_classification IN ('Public', 'Internal', 'Confidential', 'Restricted / Classified')),
    ADD COLUMN IF NOT EXISTS data_region TEXT NOT NULL DEFAULT 'APAC (Singapore)'
        CHECK (data_region IN ('EU (Frankfurt)', 'US (N. Virginia)', 'APAC (Singapore)')),
    ADD COLUMN IF NOT EXISTS retention TEXT NOT NULL DEFAULT '5 Years'
        CHECK (retention IN ('3 Years', '5 Years', '10 Years', 'Indefinite')),
    ADD COLUMN IF NOT EXISTS external_partner_ingestion BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ---- work_packages (spec 3.5 Card A and section 5) -----------------------------------
CREATE TABLE IF NOT EXISTS work_packages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    code        VARCHAR(50) NOT NULL,                 -- e.g. WP-1
    title       VARCHAR(500) NOT NULL,
    lead_id     VARCHAR(100),                         -- assigned lead (user id)
    due_date    DATE,
    stage       VARCHAR(50) NOT NULL DEFAULT 'Discovery'
        CHECK (stage IN ('Discovery', 'Validation', 'Business Case', 'Decided')),
    progress    INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    UNIQUE (project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_work_packages_project ON work_packages(project_id);

-- "Preceding work package dependencies selector" (spec 3.5 Card A).
CREATE TABLE IF NOT EXISTS work_package_dependencies (
    work_package_id UUID NOT NULL REFERENCES work_packages(id) ON DELETE CASCADE,
    depends_on_id   UUID NOT NULL REFERENCES work_packages(id) ON DELETE CASCADE,
    PRIMARY KEY (work_package_id, depends_on_id),
    CHECK (work_package_id <> depends_on_id)
);

-- ---- decision_gates (spec 3.5 Card B and section 5) -----------------------------------
CREATE TABLE IF NOT EXISTS decision_gates (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    gate_name            VARCHAR(255) NOT NULL,
    target_date          DATE,
    decision_owner       VARCHAR(100),
    approver             VARCHAR(100),
    acceptance_criteria  TEXT,
    gate_scope           TEXT,                        -- spec 3.5 "Gate Scope"; the spec table omitted it
    -- The spec's "Approve / Request Changes" sign-off (spec 4); "Pending" is its default.
    status               VARCHAR(50) NOT NULL DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'Approved', 'Changes Requested')),
    decided_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_decision_gates_project ON decision_gates(project_id);

-- ---- link research tasks to their work package ----------------------------------------
-- A research task (sources, threads, approval) belongs to one work package.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS work_package_id UUID REFERENCES work_packages(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_work_package_uniq ON tasks(work_package_id) WHERE work_package_id IS NOT NULL;
