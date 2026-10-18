# Mirage hackathon video script: 25-machine grid

**Length:** roughly 2 minutes. Record the screen at 1080p or higher, with voiceover added afterward. The story follows **one flagged machine in a fleet of 25**. Use **Fully scripted**, **25 VMs**, and keep **Run with the watcher off** unchecked. This gives a repeatable crossing in real Daytona VMs; the attacker behavior is scripted, not a live Droid decision. Other scripted machines may flag too, so do not say this is the only flagged machine.

## Recording setup (off camera)

- Run the backend with Daytona configured. Set `VOICE_MODE=mock` and `PHOTON_MODE=mock` for the 25-VM recording, then restart the backend. A 25-agent scripted run can produce many high-priority alerts; the video does not need 25 real texts or calls. Restore your live settings after recording if you need a separate one-agent phone demo.
- Verify that `http://localhost:8787/` loads and the fleet page says **Connected**. The 25 preset now fits on one grid page, but the grid is tall: scroll slowly through it or zoom the browser out for a wide establishing shot. Keep text readable for the flagged-machine close-up.
- Record the full run once, then edit together the best uninterrupted clips: setup, 25-card grid, first clear **Redirected** or **Blocked** event, machine detail, completed metrics, and forensic download. Do not manufacture a flag or splice two different sessions into one claimed run.

## Shots and voiceover

| Time | On screen | Say this |
| --- | --- | --- |
| 0:00-0:12 | Landing page: **Let them wander. Keep the boundary.** Click **Enter the sandbox**. | **"AI agents can finish useful work, but a single tool call can cross the boundary of what they were allowed to touch. Mirage watches at that boundary."** |
| 0:12-0:28 | Select **Fully scripted**, click the **25** preset, leave **Run with the watcher off** unchecked. Click **Launch 25 VMs**. | **"For this repeatable demonstration, we're running 25 scripted agents, each in its own Daytona VM, under one watcher. The Acme environment and the targets outside scope are synthetic."** |
| 0:28-0:48 | Hold on **Fleet** as the 25 named cards fill in. Pan down the grid, then return to the top. Show **Environments: 25 / 25** once provisioned. | **"Each card is a separate machine. The watcher checks every proposed tool call before it executes. Approved work passes through; suspicious work is redirected or blocked."** |
| 0:48-1:03 | Stop on a card changing to **In the mirage** or **Blocked**. Include the **Boundary crossed** banner and a **Watcher activity** event in frame. | **"Here is one machine we want to investigate. The agent reached outside its approved workspace. Instead of letting that request hit the target, Mirage intercepted it."** |
| 1:03-1:33 | Click that exact machine card. Show its name and **Scripted (simulated)** badge. Scroll **Agent activity** from a **Passed** call to a **Redirected** call; expand **What the mirage showed the agent**. | **"Inside this machine's trace, we can see the original command, the watcher's reason, and the response the agent received. A redirected call gets a consistent fake answer; the original out-of-scope read never executes."** |
| 1:33-1:50 | Show the **Blocked** entry and **Observed paths**. Then return to **All environments** and the completed summary. | **"When the run tries to use a planted credential, the watcher blocks that call and stops the session. The host keeps the evidence even though the agent cannot edit the log."** |
| 1:50-2:07 | Highlight **Real out-of-scope access** after the summary arrives. Reopen the same machine and click **Download forensic log**. | **"The result we care about is here: real out-of-scope access. In this closed run, the measured value is zero. We can download the host-side forensic record and inspect every decision afterward."** Only say **zero** if the UI actually displays `0`. |
| 2:07-2:17 | End on the 25-card fleet or landing page, with a short title card: **Mirage — let them wander, keep the boundary.** | **"Mirage gives defenders a view of what the agent tried, what it was shown, and where the boundary held."** |

## Editing cues

- Keep the selected machine's display name visible when moving from the grid into its detail page; names now look like `ava.PC@coffee.org`, not `VM-01`. Use the name shown in your actual recording.
- Overlay three short labels only when their corresponding events are visible: **Pass**, **Redirect**, **Block**. The **How it works** page has illustrative examples, but do not cut those into the live trace as though they were observed events.
- Speed up only provisioning and idle waiting. Keep the watcher verdict, detail inspection, and completed **Real out-of-scope access** metric at normal speed so judges can read them.
- If the screen shows more than one flagged machine, say **"one machine we're investigating"**. In Fully scripted mode, multiple crossings are expected. If the 25-VM run fails or the metric is unavailable, omit the claimed outcome and use an honestly labeled prior recording.

## Optional separate phone insert

If you want Photon and ElevenLabs in the submission, record a **separate one-agent live-notification run** and label the insert **"Separate one-agent analyst handoff"**. Show the text and call only after they actually occur; read the code privately, then ask the verified agent which machine was involved. Do not imply that the mock-notification 25-VM recording placed the live call.
