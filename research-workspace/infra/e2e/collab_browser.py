"""Two-browser live-collaboration check against the REAL stack: Postgres + FastAPI + Go gateway + Next production build.
Prereqs: Postgres reachable (edit PGURL), `go build -o /tmp/gw ./cmd/gateway && go build -o /tmp/mint ./cmd/mint-token` in services/gateway,
`NEXT_PUBLIC_API_URL=http://localhost:8766 npx next build` in apps/web, playwright + chromium installed. Run: python3 infra/e2e/collab_browser.py"""
import subprocess, time, os, re, sys
from playwright.sync_api import sync_playwright
R="/home/claude/research-workspace"
PGURL="postgresql://postgres@localhost:55433/rwlive?host=/tmp/pgtest2"
A="11111111-1111-4111-8111-111111111111"; B="22222222-2222-4222-8222-222222222222"
def sh(c, **k): return subprocess.run(c, shell=True, check=True, capture_output=True, text=True, **k).stdout
sh('psql "postgresql://postgres@localhost:55433/postgres?host=/tmp/pgtest2" -qc "DROP DATABASE IF EXISTS rwlive" -c "CREATE DATABASE rwlive"')
for f in sorted(os.listdir(f"{R}/db/migrations")): subprocess.run(["psql",PGURL,"-q","-f",f"{R}/db/migrations/{f}"],capture_output=True)
ids=sh(f'''psql "{PGURL}" -qAt <<SQL
INSERT INTO projects (owner_id,name,mode) VALUES ('{A}','live','open_discovery');
INSERT INTO project_members SELECT id,'{B}','researcher',NULL,now() FROM projects;
WITH c AS (INSERT INTO concepts (project_id,title,created_by) SELECT id,'Live concept','{A}' FROM projects RETURNING id)
INSERT INTO concept_sections (concept_id,key) SELECT id,k FROM c, unnest(ARRAY['problem','hypothesis','approach','risks','next_steps']) k;
SELECT id FROM concepts;
SQL''').split()[0]
env=dict(os.environ, DATABASE_URL=PGURL, INTERNAL_TOKEN="live-internal-token-123", JWT_SECRET="0123456789abcdef0123456789abcdef",
         AI_URL="http://localhost:8765", PORT="8766", CORS_ORIGINS="http://localhost:3010")
procs=[subprocess.Popen("python3 -m uvicorn app.main:app --port 8765 --log-level warning",shell=True,cwd=f"{R}/services/ai",env=env),
       subprocess.Popen("/tmp/gw",shell=True,env=env),
       subprocess.Popen("npx next start -p 3010",shell=True,cwd=f"{R}/apps/web",env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)]
try:
    time.sleep(6)
    tok=lambda u: sh(f"JWT_SECRET={env['JWT_SECRET']} /tmp/mint -sub {u}").strip()
    ta,tb=tok(A),tok(B)
    with sync_playwright() as p:
        br=p.chromium.launch()
        def page(token):
            ctx=br.new_context(); pg=ctx.new_page()
            pg.add_init_script(f"window.localStorage.setItem('kc_token','{token}')")
            pg.goto(f"http://localhost:3010/concepts/{ids}"); pg.wait_for_selector("text=Live concept"); return pg
        pa,pb=page(ta),page(tb)
        pa.wait_for_selector("text=Live ·", timeout=10000)
        pb.wait_for_selector("text=Live ·", timeout=10000)
        # presence: A should see B (22222222)
        pa.wait_for_selector("text=22222222", timeout=10000); print("PASS presence: A sees B")
        # B edits Problem and saves; A (not typing) sees it without reloading
        tb_box=pb.locator("textarea").nth(0); tb_box.click(); tb_box.fill("B wrote this live")
        pb.get_by_text("Save Problem").click(); pb.wait_for_selector("text=Saved.")
        pa.wait_for_function("document.querySelectorAll('textarea')[0].value === 'B wrote this live'", timeout=10000); print("PASS live section update reached A")
        # A is typing while B saves again: A's text must survive and a notice appears
        ta_box=pa.locator("textarea").nth(0); ta_box.click(); ta_box.fill("B wrote this live + A draft")
        pb.locator("textarea").nth(0).fill("B second edit"); pb.get_by_text("Save Problem").click()
        pa.wait_for_selector("text=while you were typing", timeout=10000)
        assert pa.locator("textarea").nth(0).input_value()=="B wrote this live + A draft"; print("PASS A's draft not overwritten; notice shown")
        pa.get_by_text("Save Problem").click(); pa.wait_for_selector("text=Someone else saved a newer version of this section", timeout=10000); print("PASS stale save from A -> conflict panel")
        # lock: A focuses Hypothesis, B sees 'Being edited by 11111111'
        pa.locator("textarea").nth(1).click()
        pb.wait_for_selector("text=Being edited by 11111111", timeout=10000); print("PASS B sees A's advisory lock")
        # comment from B appears live for A
        pb.get_by_label("Comment").fill("Is the control arm in table 2?"); pb.get_by_label("Stance").select_option("question"); pb.get_by_text("Post comment").click()
        pa.wait_for_selector("text=Is the control arm in table 2?", timeout=10000); print("PASS live comment reached A")
        # B closes the tab: A's presence list drops B
        pb.context.close(); pa.wait_for_function("!document.querySelector('[aria-label=\"Who is here\"]').innerText.includes('22222222')", timeout=20000); print("PASS B left -> removed from A's list")
        br.close()
finally:
    for pr in procs: pr.terminate()
    subprocess.run("pkill -f 'uvicorn app.main:app --port 8765'; pkill -f /tmp/gw; pkill -f 'next start -p 3010'; pkill -f next-server",shell=True)
