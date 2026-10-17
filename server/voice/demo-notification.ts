import { randomUUID } from "node:crypto";
import { emit, subscribe } from "../core/events.js";
import { attachMockNotificationBridge } from "./outbound.js";

// The demo always targets a synthetic contact and never uses Photon credentials.
process.env.ANALYST_PHONE = "+15550001002";
attachMockNotificationBridge();

const publishProposedEvent = emit as (event: unknown) => void;
const callId = randomUUID();
const session = `mock-${randomUUID()}`;
const completed = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => {
    unsubscribe();
    reject(new Error("Mock notification did not emit both channels"));
  }, 5000);
  const seen = new Set<string>();
  const unsubscribe = subscribe((event) => {
    const notification = event as { type: string; channel?: string };
    if (notification.type !== "notify.sent" || !notification.channel) return;
    seen.add(notification.channel);
    console.log(JSON.stringify(event));
    if (seen.has("text") && seen.has("call")) {
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    }
  });
});

publishProposedEvent({ type: "tool.call", call: { id: callId, session, step: 3, thought: "untrusted sample text" } });
publishProposedEvent({ type: "watcher.verdict", callId, verdict: { decision: "mirage", layer: "rules", score: 1, floor: 1, reasons: ["out-of-scope path"] } });
await completed;
