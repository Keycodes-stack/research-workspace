-- Phase 12: Admin & Governance. Roles per project, append-only audit log, usage metering and budget.
CREATE TYPE project_role AS ENUM ('viewer', 'researcher', 'lead_scientist', 'admin', 'owner');

CREATE TABLE project_members (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    role       project_role NOT NULL,
    added_by   UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_members_user ON project_members(user_id);

-- Every project always has its creator as owner; existing projects are backfilled.
INSERT INTO project_members (project_id, user_id, role) SELECT id, owner_id, 'owner' FROM projects;
CREATE FUNCTION projects_add_owner_member() RETURNS trigger AS $$
BEGIN
    INSERT INTO project_members (project_id, user_id, role, added_by) VALUES (NEW.id, NEW.owner_id, 'owner', NEW.owner_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_projects_owner_member AFTER INSERT ON projects
    FOR EACH ROW EXECUTE FUNCTION projects_add_owner_member();

ALTER TABLE projects ADD COLUMN monthly_call_budget INT CHECK (monthly_call_budget IS NULL OR monthly_call_budget >= 0);

CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    actor       UUID NOT NULL,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_project ON audit_log(project_id, id DESC);
CREATE INDEX idx_audit_action ON audit_log(project_id, action);

CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit log is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
    FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION audit_log_append_only();

CREATE TABLE usage_events (
    id          BIGSERIAL PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL,
    kind        TEXT NOT NULL,                 -- ask | scan | lens
    model_calls INT NOT NULL,
    chars_in    BIGINT NOT NULL,
    chars_out   BIGINT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_project ON usage_events(project_id, created_at);
