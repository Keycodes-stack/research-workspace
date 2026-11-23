-- Documentation only: records the projects-module schema decisions in the database (spec section 5).
-- No data, constraints or defaults change. Full status: docs/what_done_what_left.md

COMMENT ON TABLE projects IS 'Projects module, spec section 5. Columns from migration 013 are written by POST /projects/complete. Open (spec silent): portfolio health, progress percentage, allocated budget.';
COMMENT ON COLUMN projects.name IS 'Spec title column. Kept as name.';
COMMENT ON COLUMN projects.slug IS 'Spec route /projects/[slug]. Set on creation (name and 8 hex characters of id). Pages still route by id.';
COMMENT ON COLUMN projects.status IS 'Directory statuses (spec 2.1) plus Draft (spec 3.7 Save Draft). Save Draft is not persisted yet.';
COMMENT ON COLUMN projects.governance_stage IS 'Spec 2.1: Discovery, Validation, Business Case, Decided. Default Discovery; no flow updates it yet.';
COMMENT ON COLUMN projects.business_objective IS 'Required by the API. Nullable in the database for rows created before migration 013.';
COMMENT ON COLUMN projects.data_region IS 'Default "APAC (Singapore)". The spec default "APAC" is not in its own dropdown.';
COMMENT ON COLUMN projects.retention IS 'Default "5 Years". The spec gives no default.';
COMMENT ON COLUMN projects.currency IS 'ISO 4217 code. The spec names no list; the wizard offers USD, EUR, GBP, MYR and SGD.';
COMMENT ON COLUMN projects.executive_sponsor IS 'Spec 3.4 user dropdown. Free text until a user directory exists.';
COMMENT ON COLUMN projects.project_lead IS 'Spec 3.4 user dropdown. Free text until a user directory exists.';
COMMENT ON COLUMN projects.core_team IS 'Spec 3.4 user tokens. Not written yet: needs a user directory.';
COMMENT ON COLUMN projects.external_partner_ingestion IS 'Spec 3.6 toggle. Not mapped from the wizard yet (the wizard still has a three-option select).';
COMMENT ON TABLE work_packages IS 'Spec 3.5 Card A. One row per workstream; code is WP-n by order. Linked to its research task through tasks.work_package_id.';
COMMENT ON TABLE work_package_dependencies IS 'Spec 3.5 Card A dependencies selector. Not written by the wizard yet.';
COMMENT ON TABLE decision_gates IS 'Spec 3.5 Card B. Status values (Pending, Approved, Changes Requested) are decisions: the spec does not define them.';
COMMENT ON COLUMN decision_gates.gate_scope IS 'Added. The spec UI has a Gate Scope field, but the spec table omitted the column.';
