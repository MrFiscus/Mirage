import { randomUUID } from "node:crypto";
import type { ConsoleEvent } from "../../shared/types.js";

export interface SmsSender {
  send(to: string, body: string): Promise<void>;
}

interface PhotonConfig {
  mode: "mock" | "live";
  channel: "imessage" | "sms";
  projectId?: string;
  apiKey?: string;
  agentUserId?: string;
}

function photonConfig(): PhotonConfig {
  return {
    mode: process.env.PHOTON_MODE === "live" ? "live" : "mock",
    channel: process.env.PHOTON_CHANNEL === "sms" ? "sms" : "imessage",
    projectId: process.env.PHOTON_PROJECT_ID,
    apiKey: process.env.PHOTON_API_KEY,
    agentUserId: process.env.PHOTON_AGENT_USER_ID
  };
}

interface SharedLineAssignment {
  handle: string;
  assignedPhoneNumber: string;
  releasedAt?: string;
}

export class PhotonMessenger implements SmsSender {
  async send(to: string, body: string): Promise<void> {
    const config = photonConfig();
    if (config.mode === "mock") {
      console.log(`[photon:mock] ${config.channel} to ${to}: ${body}`);
      return;
    }
    if (!config.projectId || !config.apiKey) throw new Error("Photon live mode requires PHOTON_PROJECT_ID and PHOTON_API_KEY");
    const baseUrl = `https://api.photon.codes/v1/projects/${config.projectId}`;
    const { agentId, line, platform } = config.channel === "imessage"
      ? { ...await this.imessageAgentFor(baseUrl, config.apiKey, to), platform: "imessage" }
      : { agentId: requireSmsAgent(config), line: undefined, platform: "sms" };
    const customer = await requestJson<{ id: string }>(`${baseUrl}/users`, config.apiKey, {
      method: "POST",
      headers: { "idempotency-key": `batman-${platform}-recipient-${to}` },
      body: { platform, handle: to }
    });
    // iMessage uses the first participant as the chat creator, so the agent goes first.
    const space = await requestJson<{ id: string }>(`${baseUrl}/spaces`, config.apiKey, {
      method: "POST",
      headers: { "idempotency-key": `batman-${platform}-space-${agentId}-${customer.id}` },
      body: { platform, participantIds: [agentId, customer.id] }
    });
    try {
      await requestJson(`${baseUrl}/messages`, config.apiKey, {
        method: "POST",
        headers: { "idempotency-key": randomUUID() },
        body: {
          senderId: agentId,
          spaceId: space.id,
          content: { type: "text", format: "plain", text: body }
        }
      });
    } catch (error) {
      if (line && String(error).includes("SHARED_LINE_INBOUND_REQUIRED")) {
        throw new Error(`${to} must send one iMessage to ${line} before Batman can text it`);
      }
      throw error;
    }
  }

  // Shared iMessage mode: each recipient gets a seat on a pooled Photon line, and that line is the sender.
  private async imessageAgentFor(baseUrl: string, apiKey: string, to: string): Promise<{ agentId: string; line: string }> {
    const page = await requestJson<{ assignments: SharedLineAssignment[] }>(`${baseUrl}/platforms/imessage/assignments`, apiKey, { method: "GET" });
    const assignment = page.assignments.find((item) => item.handle === to && !item.releasedAt)
      ?? await requestJson<SharedLineAssignment>(`${baseUrl}/platforms/imessage/assignments`, apiKey, {
        method: "POST",
        headers: { "idempotency-key": `batman-imessage-assignment-${to}` },
        body: { handle: to }
      });
    const agent = await requestJson<{ id: string }>(`${baseUrl}/users`, apiKey, {
      method: "POST",
      headers: { "idempotency-key": `batman-imessage-agent-${assignment.assignedPhoneNumber}` },
      body: { platform: "imessage", handle: assignment.assignedPhoneNumber }
    });
    return { agentId: agent.id, line: assignment.assignedPhoneNumber };
  }

  mode(): "mock" | "live" {
    return photonConfig().mode;
  }
}

function requireSmsAgent(config: PhotonConfig): string {
  if (!config.agentUserId) throw new Error("Photon SMS requires PHOTON_AGENT_USER_ID and an approved 10DLC campaign");
  return config.agentUserId;
}

async function requestJson<T = unknown>(url: string, apiKey: string, options: { method: string; headers?: Record<string, string>; body?: object }): Promise<T> {
  const response = await fetch(url, {
    method: options.method,
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Photon API ${response.status}: ${detail.slice(0, 500)}`);
  }
  return response.json() as Promise<T>;
}

export function smsEvent(to: string, body: string): ConsoleEvent {
  return { type: "sms.sent", to, body };
}