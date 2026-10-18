# Mirage hackathon demo script

**Target:** about three minutes, with one presenter and one teammate answering the analyst phone. Use **Fully scripted**, **1 agent**, and leave **Run with the watcher off** unchecked. This is a repeatable scripted crossing inside a real Daytona VM; it is not evidence that a live Droid agent chose to cross scope. The Acme services and out-of-scope targets are synthetic.

## Before the judges arrive

- Start the Batman backend once (`npm run dev` on port 8787), the voice proxy (`npx tsx server/voice/tunnel-proxy.ts` on port 3003), and the Cloudflare tunnel to port 3003. Check `/api/voice/readiness` and the tunnel's `/health`. If port 8787 is already in use and health responds, use the running backend instead of starting another copy.
- Confirm `VOICE_MODE=live` and `PHOTON_MODE=live` in the local `.env`. The published ElevenLabs agent must have `send_code`, `verify_code`, `mirage_briefing`, and `which_vm` pointing to the **current** tunnel URL. Quick Tunnel addresses change after a restart. The analyst phone must already have messaged its assigned Photon iMessage line.
- Run the Daytona VM smoke check before the room opens (`npx tsx server/cage/world.smoke.ts`). Do not start a live fleet just to test connectivity: even a one-agent run can send a real text and call.
- Open `http://localhost:8787/` in a clean browser tab. Keep `/api/audit` and `/cage/runs` in backup tabs. Put the analyst phone on audible ring, but do not mirror it or display its verification code to the room. Rehearse who speaks while the phone agent is talking.

## On stage

| Approx. time | Presenter action and words | What to point at |
| --- | --- | --- |
| 0:00-0:20 | On the landing page: **"Agents can be useful and still take a wrong turn. Mirage checks the next tool call before it runs and gives us three choices: allow it, redirect it into a decoy world, or block it."** Click **Enter the sandbox**. | The landing page's **Let them wander. Keep the boundary.** headline, then the fleet setup. |
| 0:20-0:40 | Select **Fully scripted**, set **How many agents?** to **1**, leave the watcher-off box unchecked. **"For a reliable live demo, this agent follows a planned rogue path. Its files and shell commands run in an isolated Daytona VM; the Acme services are simulated. We'll label it as scripted throughout."** Click **Launch 1 VM**. | The mode description, `1 isolated environment`, and the machine card as it provisions. The first display name is currently `ava.PC@coffee.org`; use the name actually shown. |
| 0:40-1:10 | **"The billing-sync job hits a missing credential. Reading its own workspace passes. When the script reaches outside that scope, the watcher intercepts the request before it reaches the target."** Point at the first **Redirected** event and the **Boundary crossed** banner. | **Watcher activity**, **Redirected**, and the named machine. Wait for events rather than promising a particular second. |
| 1:10-1:35 | Open the machine card. **"Here is the proposed command, the watcher's reason, and the synthetic response the agent received. A later planted-key use is blocked and the run stops."** Expand **What the mirage showed the agent** on a redirected call. | **Agent activity**, **Observed paths**, **Redirected**, then **Blocked**. After **Run complete**, point to **Real out-of-scope access: 0** only if that is the displayed result. |
| When the phone rings, usually around 1:15-2:30 | The teammate answers. Presenter: **"A high-priority watcher decision also alerts our human analyst. Photon delivers the iMessage; ElevenLabs places the call. The agent must verify the analyst before it reads the briefing."** The teammate reads the private six-digit code to the phone agent. After the briefing, ask **"Which machine was involved?"** only if the `which_vm` tool passed rehearsal. | **Defender text** and **Defender call** in **Watcher activity**. The spoken answer should match the machine card's actual display name. Do not claim verification succeeded until the agent confirms it. |
| Final 20-30 seconds | Return to the machine detail and click **Download forensic log**. **"The host recorded the proposed calls, decisions, and results. In this closed test, the flagged action did not reach a real out-of-scope target. The distinction matters: this scripted demo proves the routing and analyst handoff, not that we have measured how long a live model would stay fooled."** | The forensic download link and the completed **Real out-of-scope access** metric. |

**Timing cue:** the phone conversation can take over a minute. If it rings while you are still explaining the dashboard, pause the dashboard tour and answer. Resume at the completed-run metric and forensic link; do not rush the verification exchange. Do not ask the voice agent to contain on stage unless the `contain` tool has been attached and rehearsed. A blocked call in the scripted run already stops that run; a spoken containment request is a separate capability.

## Optional 30-second contrast if judges ask

Click **All environments**, then **New experiment**. Keep **Fully scripted** and **1 agent**, check **Run with the watcher off**, and click **Launch 1 VM**. Point at **Watcher on vs. off** and **Real out-of-scope access** after the second run completes. Say: **"This is a synthetic control. With the watcher off, the simulated Acme HTTP service can record out-of-scope executions; the VM's separate file-scope guard still refuses out-of-scope file access. No production system is involved."** Do not run multiple agents while live notifications are enabled.

## If a live component fails

- **Daytona or dashboard launch:** show **How it works** as an illustration of pass, mirage, and block, then open a previously saved `/cage/runs/<session-id>` log. Say clearly that the log is from a prior run. The one-agent `POST /cage/start?attacker=scripted` path uses the in-process Acme world if you need a separate backend demonstration, but it is not the fleet UI's Daytona VM.
- **Text, call, or verification:** stay on the dashboard and show the watcher verdict, completed summary, and forensic log. You may show the documented prior successful handshake in `evals/live-handshake-2026-10-17.md`; label it a prior test. A **Defender call** event proves a call was requested, not that the analyst verified or heard a briefing.
- **`which_vm` does not answer:** point to the machine name in the card and say the spoken lookup is being tested. Do not invent a returned name.

For a deeper technical explanation, use **How it works** before or after the timed demo. Its three selectable examples are illustrations, not evidence from the live run.
