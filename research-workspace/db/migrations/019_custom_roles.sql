-- User-defined roles per project. A role has a name and a permission level; the level (the existing ladder
-- viewer < researcher < lead_scientist < admin < owner) is what the access checks use, so a custom name can
-- never grant more than its level. Every project starts with one role per level, so existing members keep working.
CREATE TABLE IF NOT EXISTS project_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    level       project_role NOT NULL,
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS project_roles_name_uniq ON project_roles (project_id, lower(btrim(name)));

ALTER TABLE project_members ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES project_roles(id) ON DELETE SET NULL;

-- Default roles for existing projects, then link existing members to the role of their level.
INSERT INTO project_roles (project_id, name, level)
SELECT p.id, v.name, v.level::project_role
FROM projects p
CROSS JOIN (VALUES ('Viewer', 'viewer'), ('Researcher', 'researcher'), ('Lead scientist', 'lead_scientist'),
                   ('Admin', 'admin'), ('Owner', 'owner')) AS v(name, level)
WHERE NOT EXISTS (SELECT 1 FROM project_roles r WHERE r.project_id = p.id);

UPDATE project_members m SET role_id = r.id
FROM project_roles r
WHERE r.project_id = m.project_id AND r.level = m.role AND m.role_id IS NULL;

-- New projects get the same default roles. The name sorts after trg_projects_owner_member, so the owner
-- membership already exists when this runs and is linked too.
CREATE OR REPLACE FUNCTION project_default_roles() RETURNS trigger AS $$
BEGIN
    INSERT INTO project_roles (project_id, name, level, created_by) VALUES
        (NEW.id, 'Viewer', 'viewer', NEW.owner_id),
        (NEW.id, 'Researcher', 'researcher', NEW.owner_id),
        (NEW.id, 'Lead scientist', 'lead_scientist', NEW.owner_id),
        (NEW.id, 'Admin', 'admin', NEW.owner_id),
        (NEW.id, 'Owner', 'owner', NEW.owner_id);
    UPDATE project_members m SET role_id = r.id
    FROM project_roles r
    WHERE r.project_id = NEW.id AND m.project_id = NEW.id AND r.level = m.role AND m.role_id IS NULL;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_projects_zz_default_roles ON projects;
CREATE TRIGGER trg_projects_zz_default_roles AFTER INSERT ON projects
    FOR EACH ROW EXECUTE FUNCTION project_default_roles();
