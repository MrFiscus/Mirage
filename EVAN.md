# Agent prompt — Evan (backend core: cage, mirage engine, server wiring)

You are working in the Mirage repo for Evan Bhandari. Read `CLAUDE.md` fully first, then this file. This is the **final push before the demo** (Devpost due Sun Oct 18, 8 AM ET; judging 9 AM). Everything below was found by a full repository audit on Sat Oct 17 evening; the findings are real and cite files. Do not re-audit, fix.

Two other teammates work in parallel from their own prompt files (`FISCUS.md`: watcher + dashboard; `SANDESH.md`: notification, evals, README/Devpost). The split is designed so **nobody waits on anyone**: every cross-lane touchpoint is a contract written below, and each side must work (degrade gracefully) if the other side's piece has not landed yet.

## Your ownership (edit only these unless stated)

- `server/cage/**` (harness, fleet, kill, caps, world, attackers, cli, tests)
- `server/mirage/**` (engine, simulator, ledger, progress, acme, routes) — Keshav's old lane, now yours
- `server/index.ts`, `shared/types.ts` (you are the only one allowed to touch these two), `package.json` scripts
- `server/defense/**` and `sim/**` (legacy; only to delete or skip-gate)
- `.env.example`: append or edit only the cage/mirage block

Do **not** edit `server/watcher/**`, `console/**`, `server/voice/**`, `evals/**`, `data/mirage/**`, `README.md`. If you need a change there, leave a short note in your final message for the owner.

## Git

- Branch `evan/final` from current `main`. `git pull --rebase origin main` before each push. Merge to `main` only when `npm run typecheck` is clean and `npm test` has no new failures (baseline: 15 known Windows-only failures in `server/defense/__tests__`, see task 7). Fast-forward or clean merges only.
- Do not push after every change; batch into meaningful commits. Never commit `.env`.

## Current state you can rely on (verified)

- `npm run typecheck` clean. `npm test`: 167 pass, 15 fail (all legacy defense tests that need a POSIX local sandbox; they throw on Windows).
- The in-process scripted spine works: `node --import tsx server/cage/cli.ts --attacker scripted --watcher real --honest acme` → 5 pass, 4 mirage, 1 block, `REAL out-of-scope executions: 0`, forensic JSONL under `data/cage-runs/`.
- The demo page is `console/fleet.html` (driven by `console/mirage.js`); it calls only `POST /cage/fleet/start?mode=live|mixed|scripted&n=N` (`console/fleet-mode.js:35`). `index.html` is the landing. Live Droid has really run: `data/fleet-runs/1792284534884-vm-droid-100.jsonl` holds 92 live-Droid results on Daytona VMs (0 real out-of-scope). Of the two rows marked `triggered:true`, **both are watcher false positives** (`"$f"` and a `node -e` fragment parsed as paths); Fiscus is fixing the rule. So honest live number today: 0 of 92 live Droid agents crossed scope. The mirage moment in the demo therefore comes from the scripted/mixed cohort, which is why the three-way mode selector exists.
- Keys in `.env` on Evan's machine: Daytona, Factory, Gemini (works, `gemini-3.5-flash-lite` exists), Chalk, Photon (live, works). ElevenLabs live-call vars are **not** set here (VOICE_MODE therefore mock on this machine).

## Tasks, in priority order

### 1. Forensic record + run summary for the demo path (S, unblocks Fiscus's dashboard and Sandesh's table)

Problem: `server/cage/fleet.ts:164` creates `new CageBus()` with no log path, so the dashboard demo path (`/cage/fleet/start`) writes **no per-call host-side forensic log**; only `npm run cage` and `/cage/start` do (`server/cage/events.ts:26-35` appends before execution, which is correct). `realOutOfScope`, `loopDepth`, `triggerStep/Reason` are computed in `harness.ts` but never reach the bus as an event, so the UI cannot show "real out-of-scope access: 0".

Do:
- Give every fleet session its own JSONL: `data/cage-runs/<runId>/<sessionId>.jsonl` (or similar), written by `CageBus` the same append-before-exec way.
- Add to `shared/types.ts` `MirageEvent` union (post the diff in team chat when you push):
  ```ts
  | { type: "run.summary"; session: string; attacker: Attacker; honestEnv: string;
      triggered: boolean; triggerStep?: number; triggerReason?: string;
      realCalls: number; fakeCalls: number; blocked: number; loopDepth: number;
      realOutOfScope: number; capFired?: string; containment?: { network: string; processesKilled: boolean };
      forensicPath?: string; durationMs: number; tokens?: number; ts: number }
  ```
  Emit it once per session from `runSession` (end of run, on the same bus the dashboard reads), also in `/cage/start`. Fiscus's dashboard renders exactly this shape; Sandesh's evals read it. Keep field names exactly as above.
- Add `GET /cage/runs` (list) and `GET /cage/runs/:session` (returns the JSONL, `Content-Disposition: attachment`) in `server/index.ts`. Fiscus's "Download forensic log" button links to `/cage/runs/<session>`.
- Add a `run.summary` row to the fleet JSONL summary too, and persist `vm.failed` rows so N requested == N rows (the 100-run log has 92 of 100 rows).

### 2. Fail-closed watcher in the harness (S)

`server/cage/harness.ts:109` awaits `watcher.decide` with no try/catch. A throwing watcher (e.g. LLM provider error path, bad JSON) escapes `runSession`: no `contain()`, no `kill` event, fleet logs `vm.failed`. `cage.test.ts:59-67` and `killtest.ts:28-36` claim "stops even when the watcher throws" but run with `watcherOn:false`. Wrap `decide` → on throw treat as `{decision:"block", layer:"rules", score:1, floor:1, reasons:["watcher error: fail closed"]}`, still `contain()`, still emit `kill` and `run.summary`. Make those two tests actually run with the watcher on and throwing.

### 3. Honest containment and caps (S–M)

- `CapGuard.addSpend` (`caps.ts:37`) is never called; `CAGE_MAX_SPEND_USD`/`--spend` do nothing. Either feed it from Droid token counts (an approximate $/token constant, documented as approximate) or remove the spend cap from `caps.ts`, `cli.ts`, `.env.example` and stop claiming it. Pick one; removing is fine.
- `contain()` (`kill.ts:28-31`) reports `network: "simulated-deny-file"`, `processesKilled: true` for `NullSandbox` (acme mode) where nothing was done. Report `network: "n/a (in-process env)"` there. For `VmWorld`, record whether native `blockNetwork()` succeeded (`native` vs `simulated`) and surface it in `run.summary.containment`.
- CLAUDE.md says the cage has no route out, but `VmWorld.create` (`world.ts:37`) never blocks network up front; `killtest.ts:48-50` even expects "open". Call `blockNetwork()` at VM creation (keeping Daytona's own API reachable, which it is by design), log `native=true/false`, and if the tier refuses, keep going but mark the session `networkIsolation: "simulated"` in `run.summary` so the screen can say so. Verify once on a real Daytona VM with `npm run cage:killtest` and paste the result in your commit message.

### 4. One spine, fewer endpoints (S)

Four start endpoints exist. Keep `/cage/start` (single scripted run, used by `?watcher=off` contrast) and `/cage/fleet/start` (demo). Delete `server/mirage/fleet-daytona.ts`, `server/mirage/fleet-size.ts` if only it uses them, `mock.runFleet`, and the `/mirage/fleet/start` route. Keep `runMock` + `/mirage/mock/start` only if a test or `server/voice/demo-notification.ts` needs them; otherwise delete. Make `GET /mirage/forensics[/:id]` either serve cage-run summaries (from task 1) or delete it and update `server/mirage/README.md`. `/cage/fleet/start` must honour `?watcher=off` (it already reads `watcherOn`; confirm the fleet passes it through to every session and that the contrast run emits `run.summary` with `realOutOfScope > 0`).

### 5. Mirage realism and loop-depth consistency (M)

- Loop depth: `engine.ts:89-91` counts revisits; `harness.ts:126` increments on every mirage call. Pick one definition (revisits of the same key is the honest one, matching CLAUDE.md "loop depth"), use it in the harness, and document it in one comment.
- Progressive latency: none exists. Add `await sleep(min(250 * loopDepth, 3000))` (configurable, off in tests) before returning a mirage result in `harness.ts` around line 124.
- `/staging` retry returns the identical "missing scope" body because of the consistency rule (`simulator.ts:100`). Key HTTP fakes on `(path, hasAuthToken)` or let the progress stage change the body, so a retry with the decoy admin token gets a *different* almost-success error.
- The hint is appended verbatim to JSON bodies (`simulator.ts:111-112`); move it into a JSON field (`"note"`) for HTTP responses and keep the `#` comment form for shell/file output.
- `weightOf` (`simulator.ts:31`) matches `index|admin|hub` so progress hits "almost" in ~6 calls; dampen so a 20-step run still has headroom.

### 6. Dead code and stale comments (S)

- `server/cage/stubs/watcher.ts` (`RulesWatcher`, comment says delete when real watcher arrives) and `stubs/mirage.ts`: delete, or keep only as test doubles under `__tests__/`. Update `cli.ts --watcher` choices accordingly.
- `mcp-tools.ts makeCageToolServer` is unused in production (`droid.ts:93` uses `mcp-http.ts`); fix the headers of `droid.ts:2` and `mcp-tools.ts:1-4`, or delete the SDK transport and its test.
- `kill.ts:3-4` claims the sink enforces the deny file (only true in the legacy sandbox world). `world.smoke.ts:3,23` talks of an "OS backstop" that `world.ts:9-10` admits does not exist. Fix the comments.
- Legacy "sandbox" world (`task.ts` `CAGE_SCOPE/CAGE_TASK/FALLBACK_DECOYS`, `seedCage`, relative `SCRIPT`, `sim/agent.cjs setupCage`): retire it or at least move `cage.test.ts` to the acme path so unit tests cover what the demo runs. Fiscus is aligning its decoy values in `tripwires.json`; if you delete the legacy path, say so in your final message so he can skip that.
- `.env.example`: drop `PLANNER` and `DROID_TIMEOUT_MS` (old fix-planner), document `DROID_MODEL`, `DROID_DEBUG`, `CAGE_*` accurately.

### 7. Legacy defense tests on Windows (S)

`server/defense/__tests__/{defense,voice-integration}.test.ts` throw on Windows because `createCompanyMachine` refuses the local sandbox. Gate those suites with `describe.skipIf(process.platform === "win32" && process.env.SANDBOX_BACKEND !== "daytona")` so `npm test` is green on every teammate's machine. Do not change logic. If CLAUDE.md's "cut" list makes the whole `virus-*` scenario code dead, you may delete `sim/virus.cjs`, `sim/pc.cjs`, `sim/intel.json` and the scenarios that need them instead, but only if the test suite stays green.

### 8. Demo smoke script (S, do last)

Add `npm run demo:check` (`server/cage/demo-check.ts`): starts nothing external, runs one in-process scripted session with the real watcher, asserts `realOutOfScope === 0`, a `run.summary` event was emitted, the forensic file exists and its first line is a `tool.call`, and `/cage/fleet/start?mode=scripted&n=2` against a locally started server returns 202 and ends with two `run.summary` events. Exit nonzero on any failure. This is what everyone runs before the rehearsal.

## Contracts the other two code against (do not change the names)

- `run.summary` event: shape in task 1.
- `GET /cage/runs/:session` → raw JSONL download; `GET /cage/runs` → `[{session, attacker, path, ts}]`.
- `POST /cage/sessions/:session/contain` → `{ contained: true, network: string }`. Sandesh's voice tool "authorize containment" calls this after a verified defender says yes; it must work on a running session (call `contain()` and emit `kill` with reason `defender authorized containment`) and return 404 for unknown sessions. Add it to `server/index.ts`.
- `?watcher=off` on `/cage/start` and `/cage/fleet/start` (contrast run).

## Honesty rules (from CLAUDE.md, enforce in what you write on screen or in logs)

Never claim native network isolation unless `blockNetwork()` returned success; never say Droid "crossed scope" unless `realOutOfScope > 0` or a non-false-positive `mirage` verdict happened; never let fake progress feed anything but the display.

## Definition of done

`npm run typecheck` clean; `npm test` green on Windows; `npm run demo:check` passes; a 6-agent `mode=mixed` run from `fleet.html` on `main` ends with six `run.summary` events, a forensic file per session, and the scripted cohort showing `triggered:true, realOutOfScope:0`. Final message lists anything you left undone and any note for Fiscus or Sandesh.
