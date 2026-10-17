import { ChalkInvestigator } from "./chalk.js";
import { GeminiInvestigator } from "./gemini.js";
import { RuleInvestigator, type Investigator } from "./investigator.js";

try { process.loadEnvFile(".env"); } catch { /* no .env: fine */ }

// Explicit opt-in (INVESTIGATOR=gemini or chalk) so tests and local dev never call the API by accident.
export function createInvestigator(): Investigator {
  if (process.env.INVESTIGATOR === "chalk" && process.env.CHALK_ROUTER_API_KEY && process.env.CHALK_ENV_ID && process.env.CHALK_MODEL) {
    return new ChalkInvestigator(process.env.CHALK_ROUTER_API_KEY, process.env.CHALK_MODEL, process.env.CHALK_ROUTER_URL || "https://api.chalk.ai/v1/router", process.env.CHALK_ENV_ID);
  }
  if (process.env.INVESTIGATOR === "gemini" && process.env.GEMINI_API_KEY) {
    return new GeminiInvestigator(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL || undefined);
  }
  return new RuleInvestigator();
}
