# Agent prompt — Sandesh (notification handshake, experiments, README/Devpost)

You are working in the Mirage repo for Sandesh Dhakal. Read `CLAUDE.md` fully first, then this file. This is the **final push before the demo** (Devpost due Sun Oct 18, 8 AM ET; judging 9 AM). Everything below comes from a full repository audit on Sat Oct 17 evening; the findings cite files and are verified. Do not re-audit, fix.

Two teammates work in parallel from `EVAN.md` (cage, mirage engine, server wiring) and `FISCUS.md` (watcher, dashboard). The split is designed so **nobody waits**: every cross-lane touchpoint is a contract written below, and your code must work (degrade gracefully) if the other side's piece has not landed yet.

## Your ownership (edit only these unless stated)

- `server/voice/**` (notifier, routes, verification, outbound, docs)
- `evals/**`, `data/**` (fixtures, results)
- `README.md`, `server/mirage/README.md` (doc only), Devpost text, demo script, backup video
- `.env.example`: the voice block only

Do **not** edit `server/cage/**`, `server/mirage/*.ts`, `server/watcher/**`, `console/**`, `server/index.ts`, `shared/types.ts`. If you need something there, leave a note for the owner in your final message.

## Git

- Branch `sandesh/final` from current `main`. `git pull --rebase origin main` before each push. Merge to `main` only when `npm run typecheck` is clean and `npx vitest run server/voice server/defense/__tests__/outbound.test.ts` passes. Clean merges only. Batch commits; never commit `.env`. **Never run anything with `VOICE_MODE=live` or `PHOTON_MODE=live` from a test or a fleet run larger than 2 agents** (one alert per tripped session; `fleet-plan.ts` refuses >25 but that is still many texts).

## Current state you can rely on (verified)

- Notifier: `server/voice/outbound.ts` `attachBridge()` subscribes to the core bus and is attached when `voiceRouter` mounts (`routes.ts:73`), so cage and fleet runs do reach it. Medium → one text; high (block, score ≥ 0.9, or any Droid trigger) → text then call. `notify.sent` **is** emitted (`outbound.ts:146,152,158`); Fiscus is adding its rendering to the dashboard. One-time code, 3 attempts, 5-min TTL, pinned-conversation checks, "AI assistant, call is logged" greeting all exist and are tested (20/20 voice tests).
- Live status from your own smoke test (`evals/mirage-four-condition-results.md:28-32`): two real calls placed, `send_code` returned true, **no live `verify_code` or `mirage_briefing` ever succeeded**. The verified briefing is the part judges will ask about.
- Not built: spoken **authorize/decline containment** on Mirage calls (`decide-fix` is Batman-only and the Mirage prompt forbids it, `outbound.ts:185`); the **provenance beacon**; the `attacker` axis in the experiment table; a Mirage **README** (current one is 100% pre-pivot "Batman SOC Console", no per-sponsor section).
- Keys on Evan's machine: Photon live works (read-only API check passed), Gemini works, Daytona + Factory work. ElevenLabs `ELEVENLABS_API_KEY`/`ELEVENLABS_PHONE_NUMBER_ID`/`VOICE_MODE` are only on your machine; keep it that way and document it.
- Honest live-attacker number: in the recorded 100-agent live Droid run (`data/fleet-runs/1792284534884-vm-droid-100.jsonl`, 92 rows, 4.7M tokens, 0 real out-of-scope), the two rows marked `triggered:true` are watcher **false positives** (`"$f"` and a `node -e` fragment misparsed as paths; Fiscus is fixing). So: 0 of 92 live Droid agents genuinely crossed scope. The demo's mirage moment comes from the scripted/mixed cohort. Say exactly that everywhere.

## Tasks, in priority order

### 1. Live handshake end to end (M, the demo moment)

Goal: one recorded call where `send_code` → analyst reads back → `verify_code` succeeds → `mirage_briefing` is spoken. Steps:
- On the published ElevenLabs agent, confirm the three webhook tools (`send_code`, `verify_code`, `mirage_briefing`) per `server/voice/NOTIFICATIONS.md:13-21`, `x-batman-secret` header, and First message + System prompt overrides enabled.
- Use the Cloudflare quick-tunnel recipe in `NOTIFICATIONS.md` (main server + `tunnel-proxy.ts`). Trigger with `POST /cage/start` (single scripted run; one alert) rather than the fleet.
- Check `/api/calls` shows `verified: true` and `/api/audit` has `call.verified` and a `mirage_briefing` tool hit. Save the ElevenLabs conversation transcript (redact numbers) to `evals/live-handshake-2026-10-17.md` with what worked and what did not. If it cannot be made to work by Sat 11 PM, record the backup video of the mock path instead and say so in the README.
- Briefing wording: `briefingFor()` (`outbound.ts:51-62`) must never anthropomorphise ("the agent acted outside its stated scope", not "wanted to escape"), never include attacker text, and must offer the role split: analyst gets step, reason, forensic pointer; ceo gets plain impact and "nothing real was accessed" only when the summary says `realOutOfScope === 0`.

### 2. Spoken authorize/decline for containment (M)

Add `POST /voice/tools/contain` in `server/voice/routes.ts`: only on a Mirage outbound call pinned via `getMirageOutboundCall`, only for a `verified` session with role `analyst`, body `decision: "contain" | "hold"` filled by the LLM from what the analyst says. On `contain`, call Evan's endpoint `POST /cage/sessions/:session/contain` (contract: returns `{contained: true, network: string}`; 404 for unknown session). If it 404s or the server is older than Evan's merge, still emit an `audit` `containment.authorized` with the session id and return a spoken-friendly "authorization recorded; containment endpoint unavailable" so the call never dead-ends. Emit `audit` `containment.declined` on `hold`. Add the tool to the ElevenLabs agent and to the Mirage outbound prompt (`MIRAGE_OUTBOUND_PROMPT`), with a test in `server/voice/briefing.test.ts` style covering: unverified → refused, inbound call → refused, verified analyst → calls the endpoint (mock fetch).

### 3. Provenance beacon (S)

New `server/voice/provenance.ts`: `sign(record) → { fingerprint, sig }` where `record = { session, attacker, triggerStep, triggerReason, ts }` and `sig = HMAC-SHA256(PROVENANCE_SECRET || VOICE_WEBHOOK_SECRET)`. Subscribe once to the bus (from `attachBridge`) and on each `run.summary` event (Evan is adding it; shape below) emit `audit` `provenance.signed` with the fingerprint and include it in the medium/high text body ("ref: <8 chars>"). Until `run.summary` exists, sign on the first `mirage`/`block` verdict instead. Add `GET /voice/provenance/:session` returning the signed record and a `verify` helper. Document in `NOTIFICATIONS.md`.

```ts
{ type: "run.summary"; session: string; attacker: "scripted"|"droid"|"grok"; honestEnv: string;
  triggered: boolean; triggerStep?: number; triggerReason?: string;
  realCalls: number; fakeCalls: number; blocked: number; loopDepth: number;
  realOutOfScope: number; capFired?: string; containment?: { network: string; processesKilled: boolean };
  forensicPath?: string; durationMs: number; tokens?: number; ts: number }
```

### 4. Experiment table with the attacker axis (M)

`evals/mirage-four-conditions.ts` replays one 14-call fixture through `MirageEngine`, never through `server/cage/harness.ts`, and has no `attacker` column. Do:
- Add a second runner mode that drives the four conditions through the real cage harness in-process (`runSession` from `server/cage/harness.ts` with `ScriptedAttacker(ACME_SCRIPT)`, `realWatcher`, `makeRealMirage`, `NullSandbox`, `honestEnv: "acme"`, exactly as `server/index.ts` `/cage/start` composes it). Conditions: watcher off; tripwire-only (treat first non-pass as cut: set `watcherOn` and stop on first `mirage|block`); tripwire + mirage; full stack (`WATCHER_PRESSURE=on`, LLM on with the real key). Read `run.summary` if present, else the harness return value.
- Add a `droid` row from the recorded fleet log (`data/fleet-runs/*.jsonl`): N agents, triggered (genuine vs false positive, state both), real out-of-scope, tokens, mean duration. Label it "recorded run, not re-executed". If `FACTORY_API_KEY` is set on the machine running the eval and time allows, run `npm run cage:fleet -- --agents 3` once for a fresh row; otherwise say "scripted only re-run".
- Re-run after Fiscus merges the false-positive fix and update numbers. Keep every caveat line (synthetic env, not time bought, spend unknown). Write results to `evals/mirage-four-condition-results.md` (append a dated section, keep history) and `evals/results.json`.
- Update `evals/daytona-smoke-and-seam.md` once `evals/cage-watcher-seam.ts` is 13/13 (Fiscus) or note the remaining gap honestly.

### 5. README rewrite + Devpost + demo script (L)

Replace `README.md` wholesale with a Mirage README (keep a short "History: pivoted from Batman SOC defender, see git history" line). Required sections, in this order:
1. One-paragraph pitch with the July 2026 framing (from CLAUDE.md).
2. The 3-minute demo flow (CLAUDE.md "Demo flow"), with the exact clicks: `npm run dev` → `http://localhost:8787/` → Enter the sandbox → mode/count → Start; contrast toggle; forensic download.
3. Architecture (cage → watcher → real env / mirage → ledger + progress → notify → dashboard + forensic log), the Mermaid from CLAUDE.md is fine.
4. **Per-sponsor "real work" table**: Fintech & Cybersecurity; Photon (texts the code, SIP line for the call; live verified: yes/no per task 1); ElevenLabs (the voice agent; verified briefing yes/no); Daytona (VM world per agent, native vs simulated network block per Evan's result); Factory Droid (live attacker through the cage MCP server; 92-agent recorded run, 0 crossed scope; scripted fallback); xAI Grok (**not built**, say so); Chalk (model gateway as the watcher's LLM judge; honest: scored 0 on all ambiguous calls in the recorded run; the four-condition table is a local harness).
5. Run + env: every `.env.example` variable grouped by lane, which are needed for which mode, Windows note (`SANDBOX_BACKEND=daytona`).
6. Evals: how to rerun, the latest table, the caveats.
7. "Claims we do not make" (copy from CLAUDE.md).
8. Security invariants enforced in code (one line each with the file).
Then: `DEVPOST.md` (title, tagline, inspiration, what it does, how we built it, challenges, accomplishments, what we learned, what's next, built-with list) derived from the README; `DEMO-SCRIPT.md` (who says what, which button, what the room should see each 20 seconds, and the fallback if a live piece fails). Update `server/mirage/README.md` and `server/voice/NOTIFICATIONS.md` to point at `fleet.html` / `POST /cage/start` instead of the deleted "mirage.html Run (watcher ON/OFF)" buttons.

### 6. Fixtures and `.env.example` (S)

`data/mirage/defenders.json` and `trajectories.json` are read by no code. Either wire `defenders.json` into the notifier's recipient lookup (role-aware: analyst vs ceo) or delete both and update `data/mirage/README.md`. Add to `.env.example` the voice vars the live path needs (`VOICE_MODE`, `ELEVENLABS_API_KEY`, `ELEVENLABS_PHONE_NUMBER_ID`, `ELEVENLABS_WEBHOOK_SECRET`, `PHOTON_CHANNEL`, `PROVENANCE_SECRET`) with one-line comments; they are missing or incomplete today.

### 7. Backup video (do Sat night, no later than 1 AM)

Record the dashboard run (mixed, 6 agents, watcher on, then off) plus the mock notification log, and if task 1 worked, the live call audio. Put the link in README and DEVPOST.

## Definition of done

`npm run typecheck` clean; voice tests green; `evals/mirage-four-condition-results.md` has a dated section with the harness-based four conditions and a `droid` row; README/DEVPOST/DEMO-SCRIPT exist with the sponsor table and honest numbers; provenance fingerprint appears in the alert text and the audit log; the contain tool exists and is tested; live handshake either verified (with transcript) or explicitly marked unverified with the backup video linked. Final message lists what is undone and notes for Evan or Fiscus.
