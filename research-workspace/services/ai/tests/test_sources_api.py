"""Source upload and search endpoints: real Postgres, fake S3, deterministic embedder."""
from tests.fakes import USER_A, USER_B, hdr
from tests.helpers import make_pdf

PDF_A = make_pdf([["Liquid injection stability study", "stored at 4 C for twelve weeks"]])
PDF_SECRET = make_pdf([["Confidential assay protocol", "internal compound zeta nine"]])


def mk_project(api, user=USER_A, mode="closed_repository"):
    r = api.post("/projects", json={"name": "p", "mode": mode}, headers=hdr(user))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def upload(api, project, data, name="d.pdf", user=USER_A, **form):
    return api.post(f"/projects/{project}/sources/upload", headers=hdr(user),
                    files={"file": (name, data, "application/pdf")}, data=form)


def test_upload_search_and_project_isolation(api):
    p1, p2 = mk_project(api), mk_project(api)

    r = upload(api, p1, PDF_A, "study.pdf", title="Study A")
    assert r.status_code == 201, r.text
    s1 = r.json()["source_id"]
    assert r.json()["chunks"] >= 1
    assert any(k[1].endswith(f"{s1}.pdf") for k in api.s3.objects)

    s2 = upload(api, p2, PDF_SECRET, "secret.pdf").json()["source_id"]

    r = api.post(f"/projects/{p1}/search", headers=hdr(),
                 json={"query": "liquid injection stability", "source_ids": [s1]})
    hits = r.json()["hits"]
    assert hits and hits[0]["intact"] is True and hits[0]["source_id"] == s1

    # project 1 asking for project 2's document gets nothing
    r = api.post(f"/projects/{p1}/search", headers=hdr(),
                 json={"query": "confidential assay", "source_ids": [s2]})
    assert r.status_code == 200 and r.json()["hits"] == []

    listing = api.get(f"/projects/{p1}/sources", headers=hdr()).json()["sources"]
    assert [s["title"] for s in listing] == ["Study A"] and listing[0]["chunks"] >= 1


def test_upload_validation(api):
    p = mk_project(api)
    assert upload(api, p, b"not a pdf at all").status_code == 415
    r = upload(api, p, make_pdf([[]]))
    assert r.status_code == 422 and "scanned" in r.json()["detail"]
    assert upload(api, p, make_pdf([["secret"]], user_pw="pw")).status_code == 422

    missing = "00000000-0000-0000-0000-000000000000"
    assert upload(api, missing, PDF_A).status_code == 404


def test_other_users_cannot_touch_the_project(api):
    p = mk_project(api, USER_A)
    assert upload(api, p, PDF_A, user=USER_B).status_code == 404
    assert api.post(f"/projects/{p}/search", headers=hdr(USER_B),
                    json={"query": "anything", "source_ids": []}).status_code == 404
    assert api.get(f"/projects/{p}/sources", headers=hdr(USER_B)).status_code == 404
