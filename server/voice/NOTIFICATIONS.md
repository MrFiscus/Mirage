# Defender notification mock

Run `npx tsx server/voice/demo-notification.ts` from the repository root. It emits a synthetic `tool.call` followed by a `watcher.verdict`, then logs a mock text and mock call to the synthetic analyst. It needs no API keys and does not contact Photon or ElevenLabs.

The voice router attaches this bridge to the existing event bus. It reacts once per attacker session to `mirage` or `block`, sends the text before the call, and emits `notify.sent` for each mock channel. It ignores `pass` verdicts and never copies attacker text or watcher reasons into the outgoing message. The proposed Mirage event types are kept local to this folder until the shared contract lands.

`POST /voice/tools/mirage-briefing` returns a role-filtered briefing only after the caller's server-side one-time-code verification succeeds. The tool still needs to be attached to the ElevenLabs agent for live calls. Live outbound dialing and spoken containment approval remain to be integrated after the watcher and cage contracts are available.
