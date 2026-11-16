"""Approval chain: researcher -> VPs -> CEO, with mandatory remarks for changes, plus the VP view."""
from app.routes_approvals import actionable, chain_status
from tests.fakes import USER_A, USER_B, hdr
from tests.test_concepts import make_concept, no_gate  # noqa: F401  (no_gate is an autouse fixture)

VP2 = "33333333-3333-4333-8333-333333333333"
CEO = "44444444-4444-4444-8444-444444444444"


def row(stage, who, decision="pending"):
    return {"stage": stage, "reviewer_id": who, "decision": decision}


# ---- pure state machine (no database) ----------------------------------------

def test_chain_status_progression():
    assert chain_status([]) == "none"
    assert chain_status([row("vp", "a"), row("vp", "b", "approved"), row("ceo", "c")]) == "awaiting_vps"
    assert chain_status([row("vp", "a", "approved"), row("vp", "b", "approved"), row("ceo", "c")]) == "awaiting_ceo"
    assert chain_status([row("vp", "a", "approved"), row("vp", "b", "approved")]) == "approved"
    assert chain_status([row("vp", "a", "approved"), row("ceo", "c", "approved")]) == "approved"
    assert chain_status([row("vp", "a", "changes_requested"), row("vp", "b")]) == "changes_requested"


def test_ceo_is_not_actionable_before_all_vps_approve():
    rows = [row("vp", "a", "approved"), row("vp", "b"), row("ceo", "c")]
    assert actionable(rows, "c") is None and actionable(rows, "b") is not None
    rows[1]["decision"] = "approved"
    assert actionable(rows, "c") is not None
    assert actionable(rows, "stranger") is None


# ---- API ----------------------------------------------------------------------

def add_member(api, project, user, role="lead_scientist"):
    r = api.post(f"/projects/{project}/members", headers=hdr(USER_A), json={"user_id": user, "role": role})
    assert r.status_code == 201, r.text


def request(api, cid, vps, ceo=None, user=USER_A):
    body = {"vp_ids": vps, **({"ceo_id": ceo} if ceo else {})}
    return api.post(f"/concepts/{cid}/approval/request", headers=hdr(user), json=body)


def decide(api, cid, user, decision, remarks=""):
    return api.post(f"/concepts/{cid}/approval/decide", headers=hdr(user), json={"decision": decision, "remarks": remarks})


def test_full_chain_to_approved(api):
    p, _, cid = make_concept(api)
    for u in (USER_B, VP2, CEO):
        add_member(api, p, u)
    assert request(api, cid, [USER_B, VP2], CEO).status_code == 201
    assert request(api, cid, [USER_B]).status_code == 409                       # round already open

    assert decide(api, cid, CEO, "approved").status_code == 409                 # CEO must wait for the VPs
    assert decide(api, cid, USER_B, "approved").json()["status"] == "awaiting_vps"
    assert decide(api, cid, VP2, "approved", "Looks sound").json()["status"] == "awaiting_ceo"
    assert api.get(f"/concepts/{cid}/approval", headers=hdr(CEO)).json()["awaiting_you"] is True
    assert decide(api, cid, CEO, "approved").json()["status"] == "approved"
    assert decide(api, cid, CEO, "approved").status_code == 403                 # nothing pending any more


def test_changes_need_remarks_and_start_a_new_round(api):
    p, _, cid = make_concept(api)
    add_member(api, p, USER_B)
    request(api, cid, [USER_B])
    assert decide(api, cid, USER_B, "changes_requested", "too short").status_code == 422
    r = decide(api, cid, USER_B, "changes_requested", "Cold-chain cost needs a second source")
    assert r.json()["status"] == "changes_requested"

    ex = api.get(f"/projects/{p}/executive", headers=hdr(USER_B)).json()
    assert ex["summary"]["blocked"] == 1
    assert ex["concepts"][0]["blockers"][0]["remarks"].startswith("Cold-chain")

    assert request(api, cid, [USER_B]).json()["round"] == 2                     # researcher revised and re-requested
    a = api.get(f"/concepts/{cid}/approval", headers=hdr(USER_B)).json()
    assert a["round"] == 2 and a["status"] == "awaiting_vps" and len(a["history"]) == 1


def test_only_named_reviewers_can_decide_and_reviewers_must_be_members(api):
    p, _, cid = make_concept(api)
    add_member(api, p, USER_B)
    assert request(api, cid, [VP2]).status_code == 422                          # VP2 is not a member
    assert request(api, cid, [USER_B, USER_B]).status_code == 422               # duplicate reviewer
    assert request(api, cid, [USER_B], user=USER_B).status_code == 201            # a lead scientist may request
    assert decide(api, cid, USER_A, "approved").status_code == 403              # owner was not named


def test_executive_view_shows_what_awaits_you(api):
    p, _, cid = make_concept(api)
    add_member(api, p, USER_B)
    request(api, cid, [USER_B])
    mine = api.get(f"/projects/{p}/executive", headers=hdr(USER_B)).json()
    theirs = api.get(f"/projects/{p}/executive", headers=hdr(USER_A)).json()
    assert mine["summary"]["awaiting_you"] == 1 and theirs["summary"]["awaiting_you"] == 0
    assert mine["concepts"][0]["approval"] == "awaiting_vps" and mine["concepts"][0]["progress"] == 0
