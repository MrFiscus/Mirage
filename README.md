# Batman SOC Console

Batman is a synthetic SOC defender demo for HackHarvard 2026. It shows an incident moving from detection through investigation, clone validation, approval, and resolution while keeping an audit trail visible to the operator.

## Run locally

Requires Node 20 or newer.

```sh
npm install
npm run dev
```

Open [http://localhost:8787](http://localhost:8787). Select **Start scenario** to create a new case. The console receives incident updates and audit entries over WebSocket at `/events`.

The API also exposes:

- `GET /api/incidents` and `GET /api/incidents/:id`
- `GET /api/audit`
- `POST /api/demo/start`
- `POST /api/incidents/:id/advance` with a validated status body
- `GET /api/health`

## Architecture

- `shared/types.ts` is the event and domain contract shared by server and console.
- `server/core/store.ts` provides the shared incident, session, caller, and audit APIs. Runtime state is persisted in `data/runtime-state.json` for a demo-friendly local store; replace this adapter with SQLite for deployment without changing the callers.
- `server/core/events.ts` emits every console event and writes audit events.
- `console/` is a compact operator view designed for scanning from a room: case queue, evidence, clone checks, action state, and audit stream.
- `data/` contains synthetic users, incidents, and labeled events only.
- `evals/run.ts` reports the initial detection metrics and documents the remaining evaluation dimensions to connect to Chalk.

## Factory Droid integration point

The defense lane should call Factory Droid from the `proposedFix` stage, run its commands against a Daytona clone, and populate `FixPlan.cloneCheck`. The core console already renders those checks and exposes the approval state. A fix must not be applied to the company sandbox until clone checks pass and a human approval event has been recorded.

No real malware, customer data, or production systems are used by this demo.
