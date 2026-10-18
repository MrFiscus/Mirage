# Live Mirage handshake check — 2026-10-17

One scripted cage run was started against the already-running local backend after the analyst approved a single live test. The backend health and voice readiness endpoints reported healthy/ready before the run. The configured analyst was registered, and a read-only Photon assignment check showed an active shared-line assignment.

The run completed with session `5536ab36`. Its audit included `notification.priority_checked` entries at medium and high priority, followed by `notification.failed` with the older backend's generic “Defender notification delivery failed” detail. `/api/calls` remained at 9 records and no `call.mirage_outbound` event appeared. There is no evidence that this run sent a Photon message, placed an ElevenLabs call, or reached `send_code`, `verify_code`, or `mirage_briefing`. Consequently there is no transcript to redact or attach.

The running process appears to be older than the checkout: it returned 404 for `GET /cage/runs`, a route present in the current source. The local notifier has since gained safe failure-stage audit details (`text` or `call`, selected HTTP status / shared-line prerequisite), but that code has not been exercised by the long-running process. Restart the backend from the current checkout, confirm the ElevenLabs tools and current tunnel URL, then obtain approval for a separate single live retest. Inspect `notification.failed`, `notify.sent`, `/api/calls`, and `call.verified` / `mirage_briefing.delivered` audits before declaring the handshake verified.

## Successful tracked retest, later on 2026-10-17

The analyst destination was changed to the registered phone ending `6319`. Photon assigned that recipient a shared iMessage line. The main backend was restarted to load the new `.env`, and `send_code`, `verify_code`, and `mirage_briefing` were pointed at a newly created healthy Quick Tunnel. One scripted cage run produced session `60c43b9f` and placed tracked outbound conversation `conv_1101m56eh550ej395fnc9x5b4245`.

The backend audit recorded `verification.code_sent`, `verification.succeeded`, `call.verified` as analyst, and `mirage_briefing.delivered` for that session, in that order. `/api/calls` showed `verified: true`. ElevenLabs marked the SIP call answered and completed after 74 seconds. Its transcript shows the agent identified itself as an AI assistant, requested code readback, confirmed identity after the server accepted the code, and spoke the high-priority step-ten blocked-action briefing. The six-digit code and caller speech are deliberately omitted here.

The agent then asked the analyst to choose contain or hold, but its transcript said it could not directly contain the session. The local `/voice/tools/contain` route exists and is tested; the corresponding ElevenLabs tool is **not attached** to the published agent. Containment by voice remains unverified. The Quick Tunnel URL is temporary and must be refreshed in ElevenLabs if the tunnel stops.
