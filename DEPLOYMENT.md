# DEPLOYMENT.md — Operator Runbook

Deploying the Signal clone: Next.js frontend on **Vercel** (free Hobby) + FastAPI backend on **Render** (free web service, built from `backend/Dockerfile`). $0 total, no credit card. Source of truth: BLUEPRINT.md §11 (deployment plan) and §9 (build order).

Work top to bottom and tick each box. Part A needs no code at all — do it today. Part B happens once the code is pushed.

---

## PART A — Do this NOW (no code needed, ~20 min)

These are pure account-creation steps. Doing them early matters: Render sign-ups have scattered reports of card-verification prompts as abuse prevention, and you do not want to discover that the night before the deadline.

### A1. GitHub — create the public repo

- [ ] 1. Go to https://github.com/new (sign in first at https://github.com/login if needed).
- [ ] 2. Repository name: `signal-clone` (or your preferred name — you will reuse it everywhere below).
- [ ] 3. Visibility: **Public** (the assignment requires a public repo).
- [ ] 4. Do **NOT** check "Add a README", do **NOT** add a `.gitignore`, do **NOT** choose a license. The repo must stay empty — it will be pushed from your local machine, and an auto-created README causes a push conflict.
- [ ] 5. Click **Create repository**. Copy the repo URL shown (`https://github.com/<you>/signal-clone.git`) somewhere handy.

### A2. Render — sign up with GitHub OAuth (specifically)

- [ ] 1. Go to https://dashboard.render.com/register
- [ ] 2. Click **GitHub** — sign up with GitHub OAuth, **not** email/password. Why: there are scattered reports of Render asking new accounts for card verification as anti-abuse; GitHub-OAuth accounts (with real history behind them) have a smoother time. This is exactly the trap you're defusing by doing this early.
- [ ] 3. When GitHub prompts, **Authorize Render** and grant it access to your repos (all repos, or at least `signal-clone`).
- [ ] 4. Complete any email confirmation Render asks for.
- [ ] 5. **STOP HERE.** Do not click "New Web Service" yet — that happens in Part B, after the code exists.

### A3. Vercel — sign up with the same GitHub

- [ ] 1. Go to https://vercel.com/signup
- [ ] 2. Choose **Hobby** (the free plan) and click **Continue with GitHub** — use the **same** GitHub account as A1/A2.
- [ ] 3. Authorize Vercel's GitHub app when prompted.
- [ ] 4. **STOP HERE.** Do not import any project yet — that happens in Part B.

### A4. cron-job.org — create free account (keep-warm pinger #1)

- [ ] 1. Go to https://cron-job.org/en/signup/
- [ ] 2. Create a free account (email + password; fully free, no card).
- [ ] 3. Confirm the verification email.
- [ ] 4. **Do not create any cron job yet** — the pinger is only enabled after the backend is live (Part B, step 4, and the timing matters).

### A5. UptimeRobot — create free account (keep-warm pinger #2 + uptime evidence)

- [ ] 1. Go to https://uptimerobot.com/ and click **Register for FREE** (or go directly to https://uptimerobot.com/signUp).
- [ ] 2. Create the free account (50 monitors, 5-minute interval, no card). The free plan's ToS restricts it to personal/non-commercial use — an assignment qualifies.
- [ ] 3. Confirm the verification email.
- [ ] 4. **Do not create any monitor yet** — same timing rule as A4.

**Part A done.** You now have: an empty public repo, a Render account (GitHub OAuth) with repo access, a Vercel account on the same GitHub, and two pinger accounts sitting idle.

---

## PART B — Do this at deploy time (after code is pushed, ~25 min)

Prerequisite: the code is finished locally with `backend/Dockerfile`, `render.yaml`, and `frontend/` in place.

### B1. Push the code to GitHub

- [ ] 1. From the project root, run (substitute your real repo URL from A1):

```bash
git init                                   # skip if already a repo
git add .
git commit -m "Signal clone: initial deploy"
git branch -M main
git remote add origin https://github.com/<you>/signal-clone.git
git push -u origin main
```

- [ ] 2. Refresh the GitHub repo page and confirm `backend/`, `frontend/`, and `render.yaml` are all there.

### B2. Render — create the backend web service

- [ ] 1. Go to https://dashboard.render.com/ → click **New +** → **Web Service**.
- [ ] 2. Connect/select the `signal-clone` repo.
- [ ] 3. Runtime: Render **auto-detects Docker** from `backend/Dockerfile` (root directory `backend` — `render.yaml` already declares this; if configuring by hand, set Root Directory to `backend`). Do not pick a native Python runtime.
- [ ] 4. Instance type: **Free**.
- [ ] 5. Environment variable: `FRONTEND_ORIGIN` = `https://<app>.vercel.app`. **Chicken-and-egg note:** the Vercel URL doesn't exist yet — set a placeholder now (your best guess at the future Vercel URL, e.g. `https://signal-clone.vercel.app`) and come back to fix it in step B3.6. Exact string match: scheme + host, **no trailing slash**.
- [ ] 6. Do **NOT** set `WEB_CONCURRENCY` — uvicorn silently reads it, and 2+ workers break cross-user delivery with no error. The Dockerfile already pins `--workers 1`.
- [ ] 7. Click **Create Web Service** and wait for the first build/deploy to finish (a few minutes).
- [ ] 8. Note the service URL: `https://<name>.onrender.com`. Write it down — it goes into Vercel, both pingers, and the README.
- [ ] 9. Verify in a browser: `https://<name>.onrender.com/health` returns `{"ok": true}` and `https://<name>.onrender.com/docs` renders the interactive API docs.
- [ ] 10. Keep only this ONE service in the free workspace — a second always-on free service exhausts the shared 750-hour pool mid-month and Render suspends everything.

### B3. Vercel — deploy the frontend

- [ ] 1. Go to https://vercel.com/new → **Import** the `signal-clone` repo.
- [ ] 2. **Root Directory: `frontend/`** (click Edit next to Root Directory and select `frontend`). Framework preset: Next.js (auto-detected).
- [ ] 3. Environment variables — add BOTH, and check them for **Production AND Preview** environments:
  - `NEXT_PUBLIC_API_URL` = `https://<name>.onrender.com`
  - `NEXT_PUBLIC_WS_URL` = `wss://<name>.onrender.com`

  (`<name>` = the real Render name from B2.8. Note `wss://`, not `https://`, on the second one.) These values are **baked into the JS bundle at build time** — changing them later requires a redeploy, not just a dashboard edit, so get them right now.
- [ ] 4. Click **Deploy** and wait for the build.
- [ ] 5. Note the production URL: `https://<app>.vercel.app`. Demo from this production URL, not a preview URL (previews get unique URLs and Deployment Protection can 401 the CORS preflight).
- [ ] 6. **Go back to Render** → your service → Environment → set `FRONTEND_ORIGIN` to the real `https://<app>.vercel.app` (exact string, no trailing slash) → Save. Render restarts the service with the corrected CORS origin (data reseeds — that's by design).

### B4. Enable the keep-warm pingers (ONLY after the service is live)

Timing rule: enable pingers **only after** B2.9 passed. A cold wake takes ~30–60 s, which exceeds cron-job.org's 30 s timeout — the wake-up ping logs as "failed" while still working. Harmless once live (at 5-minute cadence, failures never accumulate to its 15-consecutive-failures auto-disable), but don't let a not-yet-deployed service rack up failures.

- [ ] 1. cron-job.org: log in at https://console.cron-job.org/ → **Create cronjob** → URL: `https://<name>.onrender.com/health` → schedule: **every 5 minutes** → request method GET → save and enable. (Ping `/health`, a real route — Render intercepts `/robots.txt` while spun down, so pinging that never wakes anything.)
- [ ] 2. UptimeRobot: log in at https://dashboard.uptimerobot.com/ → **Add New Monitor** → type: **HTTP(s)** → URL: `https://<name>.onrender.com/health` → monitoring interval: **5 minutes** → create. This second pinger is redundancy (one failing never exposes a sleep window) and its dashboard doubles as uptime evidence for the demo.
- [ ] 3. Check back after ~15 minutes: both pingers green, service never spun down.

### B5. Smoke test (two browsers, on the real URLs)

- [ ] 1. Open `https://<app>.vercel.app` in two different browsers (or one normal + one incognito window).
- [ ] 2. Log in as **Alice** in one, **Bob** in the other — use the one-click "Login as Alice / Login as Bob" buttons, or any seeded phone with OTP `123456`.
- [ ] 3. Send a message from Alice → it appears live in Bob's window; Alice's tick goes single grey → double grey (delivered) → double blue/filled when Bob opens the chat (read).
- [ ] 4. Type in Bob's composer → Alice sees the "typing…" indicator.
- [ ] 5. In devtools (F12) → Network tab → filter WS: the socket connection shows `wss://<name>.onrender.com/ws?token=…` with status **101 Switching Protocols**. If you see `ws://` or no 101, stop and see Troubleshooting.
- [ ] 6. Optional depth: create a group, admin-add/remove a member, and watch the removed user's screen update live.

### B6. Fill the real URLs into README.md

- [ ] 1. In README.md's **Live demo** section, replace the placeholders:
  - `https://<app>.vercel.app` → your real Vercel production URL
  - `https://<api>.onrender.com` → your real Render URL
- [ ] 2. Commit and push this README change (it will trigger one final redeploy — that's fine NOW, but it's the last push; see B7).
- [ ] 3. After that push deploys, re-run a quick B5-style check (the redeploy wiped and reseeded the DB — expected).

### B7. The freeze rule + the warm-up ritual

- [ ] 1. **FREEZE DEPLOYS for the entire evaluation window.** Any `git push` = a Render redeploy = fresh ephemeral filesystem (total data wipe, reseed) + SIGTERM to uvicorn (every live socket drops, clients churn through reconnect). Do not push "one tiny fix" while an evaluator might be on the site.
- [ ] 2. T-24 h before the interview: confirm Render service live, both pingers green, Vercel production deploy current, and run the full two-browser smoke test (B5) on the real URLs.
- [ ] 3. **T-5 minutes before the interview:** open the production URL yourself, click through once, and send one message. This guarantees a warm instance and freshly-verified seeded data regardless of what the pingers are doing. **Leave the tab open** — the client's 25 s heartbeat counts as traffic and holds the instance awake through the interview.

---

## TROUBLESHOOTING

| Symptom | Cause | Fix |
|---|---|---|
| Socket won't connect | `ws://` used from the https page — the browser blocks it as mixed content with no useful error; and Render answers `ws://` handshakes with a 301 that breaks most clients | Use `wss://` in `NEXT_PUBLIC_WS_URL`, always. Since it's baked at build time, fixing it means correcting the Vercel env var and **redeploying** the frontend |
| CORS preflight failures on REST calls | `FRONTEND_ORIGIN` on Render doesn't exactly match the page origin (trailing slash, `http` vs `https`, wrong subdomain — it's an exact string compare); or you're demoing from a Vercel **preview** URL | Fix `FRONTEND_ORIGIN` to the exact production origin and save (Render restarts). Preview URLs are covered by the anchored `allow_origin_regex` already in the backend code — but demo from the production URL anyway. Note: CORS never affects `/ws`; don't debug the socket here |
| First load slow (~30–60 s) | Cold start — the free instance spun down after 15 idle minutes, most likely because the pingers aren't enabled (or aren't green) yet | Wait it out once (the client's backoff reconnect rides the wake automatically), then verify both pingers in B4 are enabled and green |
| Data vanished / conversations reset | A push triggered a redeploy — Render's free disk is ephemeral, so the SQLite file was wiped, then reseeded on startup. **By design** | Nothing to fix: the seed restores a demo-ready state. Prevention is the freeze rule (B7.1) — no pushes during the evaluation window |
