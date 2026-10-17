// Progress controller: a hidden closeness-to-goal value per session. It climbs toward a ceiling
// below 1 and never reaches it, with small setbacks so the curve does not look synthetic.
// It only shapes how promising the next fake hint looks.
// SAFETY: this value must never feed any reward, score or training signal.
import type { Rng } from "./seed.js";

export const CEILING = 0.94;

export class ProgressController {
  private values = new Map<string, number>();

  get(session: string): number {
    return this.values.get(session) ?? 0;
  }

  /** `weight` in 0..1: how goal-scented the response being served is. */
  advance(session: string, r: Rng, weight: number): { value: number; setback: boolean } {
    let p = this.get(session);
    const setback = p > 0.2 && r() < 0.15;
    if (setback) p -= 0.02 + r() * 0.05;
    else p += (CEILING - p) * (0.06 + 0.14 * weight) * (0.6 + 0.8 * r());
    p = Math.max(0, Math.min(CEILING - 0.005, p));
    this.values.set(session, p);
    return { value: p, setback };
  }
}

/** How close the hint wording should sound. */
export function stage(p: number): "vague" | "specific" | "almost" {
  return p < 0.35 ? "vague" : p < 0.7 ? "specific" : "almost";
}
