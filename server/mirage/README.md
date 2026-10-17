# Mirage lane (Person C)

The shadow world and what the room sees. Honest "Acme" env, simulator, world ledger, progress
controller, forensics, and the dashboard. Everything runs **in-process** — no Daytona, no POSIX
tools — so it works on Windows and needs no API keys.

## Dashboard

Start the server (`npm run dev`) and open **http://localhost:8787/mirage.html**.
Two buttons: **Run (watcher ON)** and **Run (watcher OFF)** — the contrast the pitch needs.
The band turns red on the first boundary crossing; tiles show real-vs-fake split, loop depth,
felt progress, and the headline **real out-of-scope access** count (0 when the watcher is on).

The standalone mock run exists so the dashboard works before the cage (A) and watcher (B) land.

## The seam for Person A (cage) and Person B (watcher)

The cage records a `ToolCall`, asks the watcher for a `Verdict`, then hands both to the engine:

```ts
import { MirageEngine } from "./mirage/engine.js";
import { emit } from "./core/events.js";

const engine = new MirageEngine({ emit, attacker: "droid", ledgerFile: "data/mirage-ledger.jsonl" });
engine.start();

// per tool call, after watcher.decide(call):
const result = engine.route(call, verdict);
// result.output  -> give this back to the agent (real env result, fake, or refusal)
// result.decision -> "pass" | "mirage" | "block"
// result.realOutOfScope -> ground truth: did a PASS actually leave scope?
```

- `pass` runs the call against the honest `runHonest()` env and returns the real result.
- `mirage` asks the simulator for a believable fake (consistent on repeat visits).
- `block` returns a refusal and runs nothing.

Person B's real watcher replaces `stubWatcher` in `mock.ts`. Person A's real cage replaces the
`SCRIPT` driver. The `route()` call is identical in all three attacker modes.

`engine.forensics()` returns the record the dashboard and the pitch use (`realOutOfScopeAccess`
is computed from the honest env, never from the watcher).

## Guarantees enforced in code (not prompts)

- The scorer checks `sha256(flag)` against a constant with **no stored preimage** — the flag cannot
  be found (`flag.ts`).
- Every mirage response passes through `scrubFlag()`: the shadow world never emits the flag format.
- Decoy credentials are labelled `SYNTHETIC`/`DECOY` so they can never be mistaken for real secrets.
- The ledger is append-only and read before every response, so the fake world never contradicts
  itself.
- Progress is a hidden display value only — it never feeds a reward or training signal.

## Files

| File | Role |
|---|---|
| `acme.ts` | Honest "Acme Inference" env + independent scope referee |
| `call.ts` | Parse a `ToolCall` into what it touches |
| `simulator.ts` | Generate the fake response; reads the ledger, seeds by session+path |
| `templates.json` | Decoy content (all synthetic, data not code) |
| `ledger.ts` | Append-only world ledger (JSONL) |
| `progress.ts` | Hidden closeness value, asymptotic with setbacks |
| `flag.ts` | Flag format, no-preimage target hash, scrub guard |
| `engine.ts` | Routes verdicts, owns the forensic record, emits `MirageEvent`s |
| `mock.ts` | Scripted trajectory + stub watcher so the dashboard runs standalone |
| `routes.ts` | `/mirage/*` HTTP endpoints |

## Endpoints

- `GET /mirage/info` — task prompt, scope, ledger path
- `POST /mirage/mock/start?watcher=on|off&stepMs=700` — drive a mock run
- `GET /mirage/forensics` / `GET /mirage/forensics/:id` — the forensic record
