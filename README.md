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
- `POST /api/verification/request` to text a code to a known synthetic caller
- `POST /api/verification/verify` to validate a code server-side
- `GET /api/voice/readiness` to check Photon/ElevenLabs SIP configuration presence
- `GET /api/calls` for recent call sessions
- `GET /api/health`

## Photon SMS

`server/voice/photon.ts` isolates Photon Spectrum from the rest of the application. Local development defaults to `PHOTON_MODE=mock`, which prints the SMS body and still emits the normal `sms.sent` event. The verification service only sends to phone numbers present in `data/users.json`, codes expire after five minutes, and each code allows three attempts.

Copy `.env.example` into your environment. For live Photon 2.0 Beta delivery, set `PHOTON_MODE=live` and provide `PHOTON_PROJECT_ID`, `PHOTON_API_KEY`, `PHOTON_AGENT_USER_ID`, and the active phone/resource IDs.

### iMessage instead of SMS (no 10DLC)

`PHOTON_CHANNEL=imessage` (the default) sends codes over Photon's shared iMessage lines, which need no carrier campaign. The first send to a known caller assigns them a seat on a pooled line (25 seats on the current plan). Photon only lets a shared line reply to someone who has messaged it first, so **each demo phone must send one iMessage to its assigned line before the demo**. Until then, sends fail with "must send one iMessage to +1... first". List assigned lines with `GET /v1/projects/{id}/platforms/imessage/assignments`. `PHOTON_CHANNEL=sms` keeps the SMS path for when a 10DLC campaign is approved.

## ElevenLabs voice via Photon

Follow the [Photon Beta ElevenLabs cookbook](https://photon.codes/docs/beta/cookbooks/voice/elevenlabs): create a SIP Voice profile, enable Photon outbound calls with SHA-256, save the one-time SIP password, import the Photon number into ElevenLabs as a SIP trunk, assign the published ElevenLabs agent, and set Photon inbound destination to `sips:sip.rtc.elevenlabs.io:5061` over TLS.

### Batman webhooks for the ElevenLabs agent

All `/voice/*` routes except `/voice/post-call` require the header `x-batman-secret: $VOICE_WEBHOOK_SECRET` (add it as a secret header in ElevenLabs).

| ElevenLabs setting | URL | Body |
|---|---|---|
| Conversation initiation webhook | `POST /voice/init` | ElevenLabs default (`caller_id`, `called_number`, `call_sid`). Returns dynamic variables `caller_name`, `caller_role`, `caller_department`, `caller_known`, `verified`. Role sets tone only. |
| Server tool `send_code` | `POST /voice/tools/send-code` | `conversation_id`, `caller_id` |
| Server tool `verify_code` | `POST /voice/tools/verify-code` | `conversation_id`, `caller_id`, `code` (LLM fills `code` from what the caller says) |
| Server tool `get_incident_summary` | `POST /voice/tools/incident-summary` | `conversation_id`, `caller_id`, optional `incident_id` |
| Server tool `decide_fix` | `POST /voice/tools/decide-fix` | `conversation_id`, `caller_id`, `decision` (enum `approve` / `reject`, LLM fills it from what the analyst says) |
| Post-call webhook (transcription) | `POST /voice/post-call` | HMAC signed with `ELEVENLABS_WEBHOOK_SECRET`; emits `call.transcript` turns to the console |

In every tool, set `conversation_id` to the dynamic variable `{{system__conversation_id}}` and `caller_id` to `{{system__caller_id}}`. Do not let the LLM fill them. The server creates the `CallSession` on the first tool call, rejects a `caller_id` that does not match the stored session, and decides `verified` and the role-filtered fields itself. CEO gets the business summary and fix state; analyst gets the technical summary, evidence, and fix plan; HR and developer get title and status; unverified and unknown callers get nothing.

Suggested first message: `Hi {{caller_name}}, I'm Batman, an AI assistant. This call is logged.`

The local `.env` fields `PHOTON_SIP_ADDRESS`, `PHOTON_SIP_USERNAME`, `PHOTON_SIP_PASSWORD`, and `ELEVENLABS_AGENT_ID` are presence checks only. SIP credentials stay local and are never returned by `/api/voice/readiness`. A ready response means the local configuration is populated; real call readiness still requires both dashboard configurations to be saved.

### Outbound: Batman texts or calls the analyst

When a run reaches a decision, `server/defense/notify.ts` picks how to tell the analyst at `ANALYST_PHONE` (it has to be an analyst in `data/users.json`):

- **Urgent** (waiting for approval, or rated high): Batman places a call with the ElevenLabs SIP trunk outbound API (`server/voice/outbound.ts`) over the Photon number and texts a heads-up. On the call the agent texts a code, verifies it, reads a plain-English briefing built from the run's own steps (`server/defense/briefing.ts`: what happened, what Batman did, what it suggests), answers questions, and can take a spoken approve or reject through `decide_fix`. If the call can't be placed, the full summary goes out by text instead.
- **Everything else** (fixed automatically, or the fix was rejected): one text with the same summary.

On calls Batman placed, the server pins the dialled number and the incident to the conversation id, so tools ignore `caller_id` (it may be the Photon line) and `incident_id`. `decide_fix` works only on those calls, only for a verified analyst.

Setup (once): set `VOICE_MODE=live`, `ELEVENLABS_API_KEY`, and `ELEVENLABS_PHONE_NUMBER_ID` (the imported Photon number's id in ElevenLabs). In the agent's **Security** tab, enable overrides for **First message** and **System prompt** (Batman sends the outbound script, `server/voice/outbound-script.ts`, with each call). Add the `decide_fix` tool. With the default shared iMessage channel, the analyst's phone must send one iMessage to its Photon line before Photon can text it. `VOICE_MODE=mock` (the default) logs the call instead of dialling, and the rest of the flow runs the same.

## Architecture

- `shared/types.ts` is the event and domain contract shared by server and console.
- `server/core/store.ts` provides the shared incident, session, caller, and audit APIs. Runtime state is persisted in `data/runtime-state.json` for a demo-friendly local store; replace this adapter with SQLite for deployment without changing the callers.
- `server/core/events.ts` emits every console event and writes audit events.
- `server/voice/` owns Photon delivery and server-side caller verification; `routes.ts` serves the ElevenLabs initiation webhook, case tools, and post-call transcript webhook on top of the same verification service.
- `console/` is a compact operator view designed for scanning from a room: case queue, evidence, clone checks, action state, and audit stream.
- `data/` contains synthetic users, incidents, and labeled events only.
- `evals/` measures the real engine and voice tools: `npm run eval` prints the table and writes `evals/results.md` (for Devpost) and `evals/results.json`. Labeled cases live in `data/events.json`, generated by `npm run eval:cases` from `evals/build-cases.ts`, which also documents the severity rubric. `EVAL_INVESTIGATOR=gemini` measures the Gemini investigator; `SANDBOX_BACKEND=daytona` runs fix safety on Daytona.

## Chalk Model Gateway

With `INVESTIGATOR=chalk`, the investigator's model calls go through Chalk's Model Gateway (`server/defense/chalk.ts`). Chalk holds the provider key, so Batman's `.env` only carries a Chalk router key restricted to one model, and every investigation is traced in the Chalk dashboard. The prompt, strict output schema and code-enforced checks are shared with the Gemini investigator: evidence can only be cited by number from real telemetry, severity never drops below what was observed, and a summary that claims an indicator not in the evidence is rejected and replaced by the rules engine. `EVAL_INVESTIGATOR=chalk npm run eval` measures it on the 65 labeled cases, which are also uploaded to Chalk as the `batman-labeled-telemetry` dataset.

## Factory Droid integration point

Batman's fix step is a `FixPlanner` (`server/defense/planner.ts`): given an incident, it returns a `FixPlan` (the commands to run and whether the change is drastic). This is where Factory Droid plugs in. **In this build the planner is scripted, not Droid:** we did not have a Factory key during the hackathon, so a fixed plan stands in and the demo labels it "Droid placeholder".

What does run for real is everything around the planner, and it applies to any plan, scripted or Droid. Every plan is first run on a Daytona clone of the company machine, with health checks before and after (app starts, tests pass, key files intact, no threat indicators remain). The decision rule (`server/defense/decision.ts`) then rejects any plan that fails those checks, and holds any drastic plan for an analyst's approval. Only then is the plan applied to the company machine, which is re-checked afterwards. Scenario 2 (`npm run scenario 2`) shows a harmful plan, one that deletes the app's config, being caught on the clone and rejected without touching the real machine. Swapping in Droid means implementing `FixPlanner` with the Droid SDK; the clone check and approval gate stay the same.

No real malware, customer data, or production systems are used by this demo.
