# Person 1: first pull and getting started (voice lane)

From Person 2 (defense). Read `CLAUDE.md` first; this file is only the setup steps and what to know about the other lanes.

## 1. Get the code

```sh
git clone https://github.com/MrFiscus/Batman.git   # skip if already cloned
cd Batman
git checkout main
git pull origin main
git checkout -b voice                              # CLAUDE.md: one branch per lane
npm install
```

`main` now contains the console and core (Person 3) and the defense engine and sim (Person 2).
Only edit `server/voice/`. Do not edit `shared/types.ts` without posting in team chat first.

## 2. Check it all runs (about 2 minutes)

```sh
npm run typecheck          # should print nothing
npm test                   # defense tests, 9 pass (they start and kill small local processes)
npm run dev                # console on http://localhost:8787 (leave running)
```

In another terminal, run the defense loop from the command line:

```sh
npm run scenario 1 -- --approve    # virus -> investigate -> clone check -> text -> APPROVE -> resolved
npm run scenario 2                 # harmful fix is rejected by the clone check
```

## 3. Secrets

Copy `.env.example` to `.env` and fill in your own keys. `.env` is gitignored. Never commit a key
or paste one in team chat. Add any new variable name (not the value) to `.env.example`.

## 4. What you can call (the core API)

Import from `server/core/` with explicit `.js` extensions (the repo uses NodeNext), for example:

```ts
import { lookupCaller, getSession, saveSession, getIncident } from "../core/store.js";
import { emit } from "../core/events.js";
import type { CallSession, Incident } from "../../shared/types.js";
```

- `lookupCaller(phone)` reads `data/users.json`. Real numbers: CEO `+15550001001`, analyst `+15550001002`, HR `+15550001003`, developer `+15550001004`.
- `getSession` / `saveSession` store your `CallSession`. Role and `verified` live here, never from the model or tool arguments.
- `getIncident(id)` / `listIncidents()` return `Incident`. The fields you need: `businessSummary` (CEO), `technicalSummary` + `evidence` (analyst).
- `emit({type: "call.started" | "call.transcript" | "disclosure" | "audit", ...})` is what the console renders.
- `data/incidents.json` has synthetic incidents you can build and test the call against right now.

## 5. Known gaps (read before you hit them)

1. **`sendSms` does not exist in the real core yet.** For the texted one time code, write a local mock
   in `server/voice/` (log the code to the console), and ask Person 3 where the real Photon send will live.
2. **The defense engine now uses the real core.** Incidents from `npm run scenario` or the console's demo
   panel are saved with `saveIncident` and are readable with `getIncident(id)` / `listIncidents()`. Ids look like
   `inc-1-xxxx`. Run one from the console (bottom "Demo controls" panel) and read it back in your voice tool.
3. The defense engine sends its analyst text through a stub `sendSms` in `server/defense/core.ts` (log + `sms.sent`
   event). Replace it when Photon sending exists.
4. Nothing on `main` has a public URL yet. The ElevenLabs webhook needs one (Person 3 is deploying; until then
   use a tunnel such as cloudflared or ngrok for testing).

## 6. Your lane, in order (from CLAUDE.md)

1. **Kill test first:** real phone to Photon line to SIP to ElevenLabs agent, and confirm the webhook sees `caller_id`.
   If that is not working, switch voice to Twilio and keep Photon for texts. Report the result in chat early.
2. `POST /voice/init`: look up the caller, create a `CallSession` with `verified=false`, return role, department, register.
3. Verification: texted 6 digit code, expires in 5 minutes, max 3 attempts, only the backend flips `verified`.
4. Case tool `getIncidentSummary(conversationId)`: role and `verified` come from the session; CEO gets `businessSummary`;
   analyst gets `technicalSummary` + evidence; unverified gets nothing restricted.
5. Announce "AI assistant, call is logged" at the start. Never say "breach" or "data stolen" unless a record confirms it.

## 7. Git workflow

```sh
git add server/voice
git commit -m "voice: <what changed>"
git push -u origin voice
git pull origin main     # pull main often; merge to main only when it runs
```

Port notes: console is 8787, defense dev server is 3002. Pick another port for voice (for example 3001).
