"""Organization & Access: the roles and members a project lists.

Root cause of the live failure (28 Nov 2026): the Roles and Members sections rendered empty for every
project. Two backend gaps fed that, both about rows the code trusts a migration/trigger to have made:

* list_roles trusted migration 019's backfill + trigger for the five default roles. A project whose roles
  were never created lists no roles at all, and the add-member form stays hidden behind the empty list.
* the members list trusted migration 007's owner trigger for the creator's membership row. A project
  whose row is missing lists no members, even though the project itself has an owner.

Both reads now backfill the system's own rows (the five defaults; the creator as owner) instead of
rendering empty. No invented people or custom roles: the backfill only recreates what the migrations
already promise every project has.
"""
from uuid import UUID

from tests.fakes import USER_A, db_exec, hdr
from tests.test_sources_api import mk_project

DEFAULT_ROLE_NAMES = ["Viewer", "Researcher", "Lead scientist", "Admin", "Owner"]


def _roles(api, p):
    r = api.get(f"/projects/{p}/roles", headers=hdr(USER_A))
    assert r.status_code == 200, r.text
    return r.json()["roles"]


def _members(api, p):
    r = api.get(f"/projects/{p}/members", headers=hdr(USER_A))
    assert r.status_code == 200, r.text
    return r.json()["members"]


def test_roles_backfilled_for_a_project_that_has_none(api, db_url):
    p = mk_project(api, USER_A)
    assert [r["name"] for r in _roles(api, p)] == DEFAULT_ROLE_NAMES
    # Simulate the legacy database: the roles were never created (migration 019 never ran for this project).
    db_exec(db_url, lambda c: c.execute("DELETE FROM project_roles WHERE project_id = $1", UUID(p)))
    roles = _roles(api, p)
    assert [r["name"] for r in roles] == DEFAULT_ROLE_NAMES
    assert [r["level"] for r in roles] == ["viewer", "researcher", "lead_scientist", "admin", "owner"]
    # The read also linked the owner member to the Owner role, as the migration does.
    assert [m for m in _members(api, p) if m["user_id"] == USER_A][0]["role_id"] == \
        [r for r in roles if r["level"] == "owner"][0]["id"]


def test_owner_member_backfilled_for_a_project_that_has_none(api, db_url):
    p = mk_project(api, USER_A)
    assert [m["user_id"] for m in _members(api, p)] == [USER_A]
    # Simulate the legacy database: the owner membership row is missing (migration 007's trigger never ran).
    db_exec(db_url, lambda c: c.execute("DELETE FROM project_members WHERE project_id = $1", UUID(p)))
    members = _members(api, p)
    assert [m["user_id"] for m in members] == [USER_A]
    assert members[0]["role"] == "owner"


def test_people_directory_lists_and_filters_inactive(api):
    r = api.post("/people", headers=hdr(USER_A), json={"full_name": "Dr. Alex Vance", "department": "R&D"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert api.get("/people", headers=hdr(USER_A)).json()["people"][0]["full_name"] == "Dr. Alex Vance"
    assert api.patch(f"/people/{pid}", headers=hdr(USER_A), json={"active": False}).status_code == 200
    assert api.get("/people", headers=hdr(USER_A)).json()["people"] == []
    assert [p["full_name"] for p in api.get("/people?include_inactive=true", headers=hdr(USER_A)).json()["people"]] == [
        "Dr. Alex Vance"]
