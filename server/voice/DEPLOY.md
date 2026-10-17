# Host the voice webhook on Render

Deploy only the voice server. The main Batman console does not need a public URL for ElevenLabs to call `/voice/init`.

1. In Render, create a **Web Service** from `MrFiscus/Batman`, using the branch containing `server/voice/dev-server.ts`. Choose a paid, always-on instance; Render's free web services sleep after inactivity and can take about a minute to wake.
2. Leave the repository root directory blank. Use `npm ci --include=dev && npx tsc --noEmit false --outDir build` as the build command and `node build/server/voice/dev-server.js` as the start command. Set the health-check path to `/health`.
3. Set `NODE_ENV=production`. Render supplies `PORT`; the voice server binds to `0.0.0.0` on that port. Add `VOICE_WEBHOOK_SECRET`, `PHOTON_MODE=live`, `PHOTON_CHANNEL=imessage`, `PHOTON_PROJECT_ID`, and `PHOTON_API_KEY` as service environment variables. Create a fresh random value for `VOICE_WEBHOOK_SECRET`. Never commit `.env` or paste secrets into chat.
4. Wait for `https://<your-service>.onrender.com/health` to return `{"ok":true,"service":"batman-voice"}`. A POST to `/voice/init` without the secret header should return HTTP 401.
5. In ElevenLabs workspace Agents settings, set the conversation initiation webhook to `https://<your-service>.onrender.com/voice/init` and add a secret header named `x-batman-secret` containing the same `VOICE_WEBHOOK_SECRET`. Enable **Fetch initiation client data from a webhook** in the Batman SOC agent's Security tab, then publish the agent.

The hosted URL stays the same across restarts and deploys. This repository currently stores sessions and audit records in `data/runtime-state.json`, so they reset on a hosted restart or redeploy without persistent storage. One-time verification codes also live in process memory; a restart during a call invalidates them. `data/users.json` still contains synthetic `+1555...` caller numbers, so real callers must be added to the caller registry before they can be recognized and verified.
