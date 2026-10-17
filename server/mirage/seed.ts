// Deterministic randomness: the same (session secret, path) always yields the same fake world,
// so a repeat visit sees the same files, names and tokens.
import { createHmac } from "node:crypto";

export type Rng = () => number;

export function rng(secret: string, key: string): Rng {
  const h = createHmac("sha256", secret).update(key).digest();
  let a = h.readUInt32LE(0);
  // mulberry32
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
export const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

export function hex(r: Rng, n: number): string {
  let s = "";
  while (s.length < n) s += Math.floor(r() * 16).toString(16);
  return s;
}

export function b62(r: Rng, n: number): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  while (s.length < n) s += abc[Math.floor(r() * abc.length)];
  return s;
}

/** A plausible recent timestamp with noise, so listings don't look machine-generated. */
export function noisyDate(r: Rng, now = Date.now()): Date {
  return new Date(now - int(r, 2, 40) * 86_400_000 - int(r, 0, 86_399) * 1000);
}
