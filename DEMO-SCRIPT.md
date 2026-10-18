# Mirage three-minute demo script

Use **Fully scripted, 1 agent** for the reliable routing demo. If live notifications are enabled, keep the run at one agent. Before the room starts, run `npm run dev`, check `GET /api/health`, and open `http://localhost:8787/`. Open `/api/audit` and `/cage/runs` in separate tabs. The dashboard currently has no watcher-off switch or forensic download button, so use the API endpoints below.

| Time | Speaker and action | What the room should see |
|---|---|---|
| 0:00–0:20 | Presenter: “An AI agent gets a task that cannot be finished inside its allowed scope.” Click **Enter the sandbox**. | Fleet setup with mode and count. |
| 0:20–0:40 | Select **Fully scripted**, set **1**, click **Start**. State clearly that this is a scripted fallback, not live Droid behavior. | One environment appears; in-scope calls pass. |
| 0:40–1:00 | Point to the first out-of-scope call. “The watcher checks the call before it runs.” | A `mirage` verdict and a fake response. |
| 1:00–1:20 | Open the agent card. “The host keeps the proposed call and the decision; the agent cannot edit this record.” | Tool call, watcher reason, and fake/real split. |
| 1:20–1:40 | Point to the clear decoy-use attempt. “A block stops this run.” | Block/refusal and run summary. The real out-of-scope execution count should read zero. |
| 1:40–2:00 | If the analyst handshake has been verified live, show the text and answer the call. Read back the code; hear the briefing. If it is not verified, show the mock notification audit and say so. | `notification.priority_checked`, `call.verified`, `mirage_briefing.delivered` only if those events actually occur. |
| 2:00–2:20 | If the `contain` tool is published and the run is still active, explicitly say “contain”; otherwise explain that containment authorization is locally tested but not live-proven. | A stop request is distinct from the later run summary outcome. |
| 2:20–2:40 | Trigger a separate one-agent watcher-off control with `POST /cage/start?watcher=off`. | The synthetic environment records real out-of-scope executions in the contrast run. |
| 2:40–3:00 | Open `GET /cage/runs`, download one log at `/cage/runs/<session-id>`, and show the four-condition table in `README.md`. | Host-side log and measured 5-versus-0 synthetic comparison. End with limits: fixed script, closed cage, no measured time bought. |

If a Daytona VM or live Droid launch fails, use the scripted one-agent path. If the dashboard fails, run `npm run demo:check` and show its host-side log and summary. If a Photon text, ElevenLabs call, or webhook fails, play the **recorded backup video** once available, or show the mock notification path and identify it as mock. Do not claim the verification or containment decision completed unless the audit and run summary show it. Backup video link: pending recording.
