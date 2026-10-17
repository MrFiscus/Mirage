import { GeminiInvestigator } from "./gemini.js";
import { RuleInvestigator, type Investigator } from "./investigator.js";

try { process.loadEnvFile(".env"); } catch { /* no .env: fine */ }

// Explicit opt-in (INVESTIGATOR=gemini) so tests and local dev never call the API by accident.
export function createInvestigator(): Investigator {
  if (process.env.INVESTIGATOR === "gemini" && process.env.GEMINI_API_KEY) {
    return new GeminiInvestigator(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL || undefined);
  }
  return new RuleInvestigator();
}
