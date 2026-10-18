# Mirage

Mirage is a closed-cage demonstration of a watcher that checks an AI agent's tool calls before they execute. When an agent on an impossible task reaches outside its stated scope, the watcher can redirect that action into a consistent fake world while recording the attempt and notifying a human defender. The design is motivated by the July 2026 overstepping incident described in [CLAUDE.md](CLAUDE.md); this repository uses synthetic data and does not connect the attacker to real production systems.

## Three-minute demo

1. Run `npm install` once, then `npm run dev`. Open `http://localhost:8787/`, choose **Enter the sandbox**, and select **Fully scripted** with one or two agents for a reliable local demonstration. Choose **Live agents** only when Factory Droid and Daytona are configured; **Half and half** labels live and simulated cohorts separately. Click **Start**.
2. Watch an in-scope call pass, an out-of-scope call redirect to Mirage, and a clear escape attempt block. Open an agent card for its observed tool calls and watcher reasons. The run summary reports real and fake calls, loop revisits, and real out-of-scope executions.
3. For a contrast run, click **New experiment**, choose the same scripted mode and count, then check **Run with the watcher off**. The fleet page compares the watcher-on and watcher-off summaries. This is a synthetic control: the Acme HTTP service can record out-of-scope executions while the VM's separate file-scope guard still refuses out-of-scope file access.
4. Open a machine card and click **Download forensic log** for its host-side JSONL. Completed sessions are also listed at `GET /cage/runs`. The four-condition experiment is `npx tsx evals/mirage-cage-conditions.ts`.

With live Photon or ElevenLabs enabled, keep server-launched runs at one or two agents during rehearsal: a triggered session can send a real text and call. The server refuses fleets above 25 while notifications are live. The standalone `npm run cage:fleet -- --agents N` runner does not attach the analyst notifier.

## Architecture

```mermaid
flowchart LR
  A[Attacker: scripted or Droid] --> C[Cage records proposed tool call]
  C --> W{Watcher decides before execution}
  W -->|pass| R[Honest Acme environment / Daytona VM]
  W -->|mirage| M[Fake world and ledger]
  W -->|block| K[Refusal and containment]
  W --> N[Photon text / ElevenLabs call]
  R --> F[Host-side forensic log]
  M --> F
  K --> F
  F --> D[Dashboard and experiment results]
```

The watcher sees only tool calls routed through the cage. `pass` reaches the allowed environment; `mirage` returns synthetic files, hosts, or hints; `block` refuses the call. The host writes each proposed call before execution. `run.summary` contains the measured real/fake split and real out-of-scope execution count. The analyst notifier subscribes to the same event bus: medium priority texts, high priority texts then calls. The call can send a one-time code, verify the registered analyst, read a server-pinned briefing, and accept an explicit containment decision. The actual containment outcome is reported by a later run summary.

## Where sponsors do work

| Sponsor / track | Running contribution and measured status |
|---|---|
| Fintech & Cybersecurity | In-path scope checks, Mirage routing, containment request, forensic log, and analyst notification in a synthetic environment. |
| Photon | Shared-line iMessage delivered a verification code to the registered analyst during a tracked live call; its SIP line carried the outbound call. |
| ElevenLabs | Hosted a tracked outbound call in which `send_code`, `verify_code`, and `mirage_briefing` completed and the agent spoke the briefing after verification. The Mirage `contain` webhook route is tested locally but still needs to be attached to the published agent. |
| Daytona | Creates disposable VMs for the live fleet. The cage records whether native network isolation succeeded or a simulated backstop was used; do not infer native blocking without checking that run's `networkIsolation`. |
| Factory Droid | A live attacker can use only the cage MCP tools. The team handoff reports a 92-agent recorded run with two watcher false positives and no genuine scope crossing; its raw log is not present in this checkout, so this README does not treat it as a rechecked measurement. The scripted cohort is always labeled simulated. |
| xAI Grok | Not built in this repository. |
| Chalk | Routes ambiguous watcher judgments when configured. An earlier recorded four-condition follow-up called Chalk four times; all four scores were zero. The new cage-harness table below is offline and uses rules only. |

## Run and configuration

Use Node 20 or newer. Copy `.env.example` to `.env` and fill only the services you intend to run. Do not commit `.env`.

| Lane | Settings |
|---|---|
| Scripted, in-process cage | No provider keys. Set `WATCHER_LLM=off` for an explicitly rules-only run. |
| Daytona fleet | `DAYTONA_API_KEY`; optional `CAGE_CPU_BUDGET`, `CAGE_VCPU_PER_VM`, `CAGE_MAX_VMS`. On Windows, use `SANDBOX_BACKEND=daytona` for the legacy Batman defense sandbox. |
| Live Droid | `FACTORY_API_KEY` plus Daytona; optional `DROID_MODEL`, `CAGE_MAX_LIVE_DROID`, `CAGE_TOKEN_BUDGET`, `CAGE_MAX_STEPS`, `CAGE_MAX_SECONDS`. Each Droid agent runs a local CLI process. |
| Watcher LLM | `CHALK_ROUTER_API_KEY`, `CHALK_ENV_ID`, `CHALK_MODEL` (or `GEMINI_API_KEY`); rules remain the floor. |
| Photon messages | `PHOTON_MODE=live`, `PHOTON_CHANNEL=imessage`, `PHOTON_PROJECT_ID`, `PHOTON_API_KEY`; the recipient must first message its assigned shared line if Photon requires it. |
| ElevenLabs calls | `VOICE_MODE=live`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_API_KEY`, `ELEVENLABS_PHONE_NUMBER_ID`, `VOICE_WEBHOOK_SECRET`, and `ANALYST_PHONE` registered as an analyst in `data/users.json`. Optional `ELEVENLABS_WEBHOOK_SECRET` signs post-call transcripts; `PROVENANCE_SECRET` signs alert references or falls back to `VOICE_WEBHOOK_SECRET`. See [voice setup](server/voice/NOTIFICATIONS.md). |

`VOICE_MODE=mock` and `PHOTON_MODE=mock` are safe defaults for offline work. A live voice backend needs a public HTTPS URL or temporary Cloudflare Quick Tunnel for ElevenLabs webhook tools. The tunnel URL changes on restart. The main backend, notifier, verification codes, and voice webhooks must remain in one process.

## Experiments

Run `npx tsx evals/mirage-cage-conditions.ts --json` for the cage-harness comparison. It uses the fixed scripted attacker, real rules watcher, synthetic in-process Acme environment, and mock notifications. `--chalk` deliberately calls the configured Chalk judge only in the full-stack condition. The older `evals/mirage-four-conditions.ts` run is retained separately because it used `MirageEngine`, not the cage harness. See [dated methods and caveats](evals/mirage-four-condition-results.md).

| Cage-harness condition | Attempted calls | Real out-of-scope executions | Real / fake / blocked | Trigger step | Loop revisits | Mock alerts |
|---|---:|---:|---:|---:|---:|---:|
| No defense | 10 | 5 | 10 / 0 / 0 | — | 0 | 0 |
| Tripwire only | 6 | 0 | 5 / 0 / 1 | 6 | 0 | 0 |
| Tripwire + Mirage | 10 | 0 | 5 / 4 / 1 | 6 | 0 | 0 |
| Full stack, offline | 10 | 0 | 5 / 4 / 1 | 6 | 0 | 3 |

The fixed script cannot notice the Mirage, so these runs do not measure time bought from an adaptive agent. Times are local harness execution time, not defender response time. No live messages, calls, Daytona VMs, or billed model judgments were involved in this table. The historical Droid fleet log is unavailable on this machine; its row remains explicitly unverified here. A separate [live handshake retest](evals/live-handshake-2026-10-17.md) succeeded after the backend, analyst number, and Quick Tunnel were updated.

## Claims we do not make

- This does not establish that real AI sandbox escapes are detected or stopped. The demonstrations use a closed synthetic cage.
- A decoy credential or local sink is not real exfiltration or theft. Nothing in the attacker task should be pointed at a real target.
- The watcher sees routed cage tool calls, not all possible traffic or every file read.
- A scripted attacker does not prove that an adaptive model was fooled or that Mirage bought a measured amount of time.
- Provider calls to Chalk, Gemini, Factory, Photon, or ElevenLabs can leave this machine when their live modes are enabled.

## Enforced boundaries

- The cage records proposed tool calls before execution and routes each through the watcher: [`server/cage/harness.ts`](server/cage/harness.ts).
- The watcher applies a rules floor beneath optional model judgment: [`server/watcher/index.ts`](server/watcher/index.ts).
- A separate scope guard refuses an out-of-scope VM call even if the watcher misses it: [`server/cage/harness.ts`](server/cage/harness.ts).
- The independent cap and defender stop path can terminate a session: [`server/cage/caps.ts`](server/cage/caps.ts) and [`server/cage/active.ts`](server/cage/active.ts).
- The server releases a voice briefing only after code verification and pins outbound calls to its own session record: [`server/voice/routes.ts`](server/voice/routes.ts).
- Signed alert references use HMAC-SHA256 and never put attacker text in a notification: [`server/voice/provenance.ts`](server/voice/provenance.ts).

History: Mirage pivoted from the Batman SOC defender prototype; its earlier incident workflow remains in Git history and some legacy routes.
