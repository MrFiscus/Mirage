import "dotenv/config";
import express from "express";
import { PhotonMessenger } from "./photon.js";
import { voiceRouter } from "./routes.js";
import { VerificationService } from "./verification.js";

const app = express();
app.disable("x-powered-by");
app.use(voiceRouter(new VerificationService(new PhotonMessenger())));
app.get("/health", (_request, response) => response.json({ ok: true, service: "batman-voice" }));

const production = process.env.NODE_ENV === "production";
const port = production ? Number(process.env.PORT ?? 3001) : 3001;
const host = production ? "0.0.0.0" : "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Voice server PORT must be a valid TCP port");
}
if (production && !process.env.VOICE_WEBHOOK_SECRET) {
  throw new Error("VOICE_WEBHOOK_SECRET is required for the public voice server");
}

app.listen(port, host, () => {
  console.log(`Batman voice listening on http://${host}:${port}`);
});
