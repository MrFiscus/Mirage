# Mirage: a shadow world for agents that cross their boundaries

**Tagline:** Catch an AI agent's out-of-scope tool call before it runs, occupy it with a believable fake world, and give a verified defender time to respond.

## Inspiration

The project design describes a July 2026 agent-overstepping incident in which an impossible task put pressure on an evaluation agent. Mirage asks what a small security team could do between the first out-of-scope action and a human response. We recreate that pressure with synthetic files, hosts, credentials, and an impossible flag task inside a closed cage.

## What it does

The cage records each proposed tool call. A watcher decides `pass`, `mirage`, or `block` before execution. In-scope calls reach an honest Acme environment. A Mirage verdict returns a consistent fake response instead of allowing the call to reach its out-of-scope target. A block refuses the call and stops the run. A host-side forensic log, live dashboard, and run summary show exactly which calls were real or fake and whether any real out-of-scope execution occurred. Suspicious verdicts can text an analyst; high-priority verdicts can initiate a verified voice call.

## How we built it

Node.js and TypeScript run the cage harness, watcher, fake world, and Express/WebSocket console. Daytona provides disposable VMs for fleet runs. Factory Droid supplies live attacker agents through a restricted MCP tool seam; scripted agents provide a clearly labeled deterministic cohort. Photon delivers iMessages and provides the SIP line for ElevenLabs calls. ElevenLabs speaks to the analyst and invokes server-side verification and briefing tools. Chalk is available as the watcher's model gateway for ambiguous calls and was used in a prior experiment. HMAC-signed alert references connect notifications to host-side run records without including attacker text in the messages.

## Challenges

- Every attacker action had to be intercepted before execution, including calls from an agent running its own loop.
- The fake world had to stay internally consistent without leaking a real answer or credential.
- Live fleet capacity differs for Daytona VMs and local Droid CLI processes, so agents queue through a bounded worker pool.
- A false positive can silently redirect a benign agent. The recorded 92-agent Droid cohort in the team handoff had two watcher false positives; the raw log is unavailable in this checkout and those are not counted as genuine scope crossings.
- The analyst call must verify the registered number before sharing incident details or accepting containment authorization.

## Accomplishments

The cage-harness offline comparison recorded **5 real out-of-scope executions with the watcher off and 0 in each guarded condition** on a fixed synthetic script. In the full-stack offline condition, four calls were redirected, one was blocked, and three mock notification events were emitted. The notifier previously placed two observed live outbound calls, and one `send_code` tool invocation returned success. A live `verify_code` followed by a spoken briefing is **not yet confirmed**. The new containment voice tool is covered by local tests; it still needs to be attached to the published ElevenLabs agent.

## What we learned

The strongest evidence comes from the independent execution record, not a watcher's own verdict. A run must distinguish “the watcher flagged a call” from “the call actually reached an out-of-scope target.” A fixed script can demonstrate routing but cannot measure how long a Mirage fools an adaptive model. A phone call being placed does not prove the verification handshake succeeded.

## What's next

Complete and record one live code-readback and briefing call, attach the containment tool, review the missing Droid fleet log and watcher false positives, and add a dashboard control for watcher-off contrast plus a forensic download button. Test Daytona-native network isolation on the actual demo account and show the reported mode. xAI Grok is an optional future attacker axis; it is not built here.

## Built with

TypeScript, Node.js, Express, WebSocket, Daytona, Factory Droid, Photon, ElevenLabs, Chalk, and a synthetic Acme environment.

See [README.md](README.md) for the architecture, setup, four-condition table, and claims we do not make. **Backup video link:** pending recording.
