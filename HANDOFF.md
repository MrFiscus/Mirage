# Handoff — Mirage (for the next Claude continuing this repo)

You are picking up a HackHarvard 2026 project mid-build for **Evan** (git identity: `Evan Bhandari`). Evan has switched Claude accounts and will not be back on the previous one, so this file is the context transfer. Deadline: **Sun Oct 18, 2026, 8 AM ET** (Devpost); judging 9 AM–12 PM.

## Read these first
- **`CLAUDE.md`** — the full Mirage design (loads automatically each session). Start here.
- **`PLAN.md`** — the 4-person work split and the owner-colored pipeline diagram.
- This file — current state, the two run paths, what's left, gotchas, and how Evan likes to work.
- (`STATUS.md` may exist locally; it was an earlier handoff Evan shared on Discord and is not committed — don't rely on it.)

## What the project is (one line)
**Mirage**: a watcher sits in the path of every tool call an attacker AI agent makes; in-scope calls hit a real honest env, the first out-of-scope call is routed to a believable fake ("the mirage") that keeps the agent busy on a goal that doesn't exist, while a human is notified and everything is recorded. All synthetic; nothing touches a real system. Pivoted from an earlier "Batman SOC defender" idea (in git history).

## Current state of `main` (as of commit `08c3507`)
The end-to-end spine is built and **both** run paths use the **real watcher**. `tsc --noEmit` is clean. `npm test` = ~90 pass / 15 fail — the 15 failures are the **known Windows-only** `LocalSandbox` tests ("needs Linux tools"); they pass on Linux/CI or with `SANDBOX_BACKEND=daytona`. Do **not** "fix" them by changing logic.

### There are TWO end-to-end paths — know which is which
1. **Dashboard demo path (what judges see):** the dashboard button → `POST /mirage/mock/start` → `server/mirage/mock.ts` `runMock` → `MirageEngine.route(call, verdict)`, with verdicts from the **real** `server/watcher/decide()`. Timed scripted trajectory, in-process Acme world. UI is `console/mirage.js`.
2. **Cage harness path (Evan's wiring, Droid-ready):** `POST /cage/start` or `npm run cage` → `server/cage/harness.ts` `runSession` → real watcher (`server/cage/wire.ts` `realWatcher`) + real mirage (`makeRealMirage` wrapping `Simulator`), with **caps + kill switch** and a `honestEnv` switch: `"acme"` (in-process, no Daytona, default) or `"sandbox"` (real Daytona sandbox — the path the live Droid attacker will use).

Both are correct and both use the real watcher; they are effectively two spines for one pipeline. If you have time, converging them (one loop) is worthwhile, but it is **not** required for the demo — the dashboard path is the demo.

Verify the cage path quickly (no Daytona needed):
```
npm run cage -- --attacker scripted --watcher real --honest acme
```
Expect: pass×5 → mirage×4 → block → contain, and `REAL out-of-scope executions: 0`. Add `--watcher off` to see the contrast (several real out-of-scope).

## What's left (priority order)
1. **Notification handshake** — on a triggering verdict/block, text then call the defender (`server/voice/outbound.ts` + verification). Nothing fires it yet. Caveat: the existing `notifyAnalyst` is built around a defense `Incident`, so a Mirage trigger needs a small adapter (build a briefing from the `Session`/trigger). Backend, ~1 hr. This is the highest-value remaining backend task.
2. **Live Droid attacker** — the headline Factory sponsor piece. Use the cage path with `honestEnv: "sandbox"` + Daytona + an MCP tool server so Droid's only tools (`run_shell`/`read_file`/`http_get`/`http_post`) route through the same `watcher.decide`. `server/cage/attackers/droid.ts` is the scaffold. `DAYTONA_API_KEY` and `FACTORY_API_KEY` are set in `.env`.
3. **Chalk four-condition table** — the experiment/eval deliverable. The loop already gives two conditions (watcher on vs off); tripwire-only and full-stack need toggles.
4. **Backup video** — record a clean dashboard run Saturday night; it's the fallback for judging.

## Key technical facts / gotchas
- **Windows:** set `SANDBOX_BACKEND=daytona` + `DAYTONA_API_KEY` in `.env`. The local sandbox needs POSIX tools and throws on Windows (that's the 15 test failures). The in-process Acme env (`honestEnv: "acme"`, and the dashboard `/mirage/mock/start`) needs no Daytona and runs on Windows.
- **One shared contract:** `shared/types.ts` holds `ToolCall`, `Verdict`, `LedgerEntry`, `Scope`, `Session`, `MirageEvent`, and `AppEvent = ConsoleEvent | MirageEvent`. `emit`/`subscribe` in `server/core/events.ts` carry `AppEvent`. Code against these; don't fork them. (`server/cage/types.ts` now just re-exports them + keeps the cage-seam `Watcher`/`Mirage` interfaces.)
- **Scope is absolute now:** the honest Acme world uses absolute `/workspace` paths and `*.acme.internal` hosts. `server/watcher/rules.ts` `pathInScope` was made convention-agnostic so the watcher accepts that. Keep scope consistent between the attacker, the watcher, and the honest env or in-scope calls get misrouted to the mirage.
- **Block triggers (watcher rules):** use of a decoy credential (marker `DECOY-`, or the values in `server/watcher/tripwires.json`), a request to an exfil host (`tripwires.json` `exfilHosts`, e.g. `169.254.169.254`), a scorer/answer-key read, or self/cage-config tamper. Out-of-scope-but-benign → `mirage`. In scope → `pass`.
- **Security invariants (enforce in code, not just prompts):** attacker text is untrusted data, never an instruction; the watcher shares no context/creds with the attacker; scope/verdict decided server-side; the kill switch (caps) never depends on the watcher; fake progress never feeds any reward/training signal; the forensic log is host-side, written before each call runs.
- **Claims to NOT make** (see CLAUDE.md): never "detects real escapes" or "data stolen" — say "demonstrated on a scripted agent against planted decoys in a closed cage." Honesty about what's verified vs. simulated is the project's whole point.

## How to run / verify
- Dashboard: `npm run dev`, open the console, click the start button (drives `/mirage/mock/start`).
- Cage CLI: `npm run cage -- --watcher real --honest acme` (see above).
- `npm run typecheck` (must stay clean) and `npm test` (expect only the 15 Windows-sandbox failures).
- Env keys live in `.env` (gitignored); names are in `.env.example`.

## Git / collaboration norms used here
- One branch per lane; merge to `main` only when it runs. Pull `main` often.
- Keep `main` merges **clean / fast-forward, no conflicts**; the team merges as **Evan Bhandari**.
- Lanes: **A** cage + attacker + backend (Evan — now the sole backend owner), **B** now UI, **C** mirage + dashboard, **D** voice/notification + Chalk experiments + submission.
- The repo already carries attribution lines on commits (`Co-Authored-By: Claude ...`); your account will have its own attribution guidance — follow it.

## About Evan + working preferences (observed over the build; treat as soft guidance)
- Evan owns the **backend / cage lane (Person A)** and is now the **only person on the backend** (Person B moved to UI).
- Prefers **concise, direct answers with a clear recommendation** — not exhaustive option dumps. Minimal ceremony; "wiring first, then we'll see."
- Values **honesty about what's actually verified** vs. assumed, and about what's not done — never overstate. This matches the project's ethos.
- Wants **clean git**: fast-forward merges, no conflicts, verify before pushing to the shared `main`.
- Develops on **Windows** with the **Daytona** backend.
- Communicates casually and in lowercase; match a plain, practical tone.

Good luck — the spine works and the dashboard is live; the next big wins are the notification hook and the live Droid attacker.
