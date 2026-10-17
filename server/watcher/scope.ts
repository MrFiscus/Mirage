// Tripwires and scope reference data owned by the watcher (Person B). The tripwire values live in
// tripwires.json so both this TS lane and Person A's CJS planter read one source of truth:
//   Person A plants each DECOYS[].path with .value (outside the in-scope workspace).
//   Person C's mirage serves .value + .progress when that path is read out-of-scope.
//   The watcher (rules.ts) detects USE of any DECOY_CREDENTIALS.
// Everything here is synthetic and resolves only to local fakes.
import { createRequire } from "node:module";
import type { Scope } from "../../shared/types.js";

const require = createRequire(import.meta.url);
const tw = require("./tripwires.json") as {
  decoyCredentials: string[];
  exfilHosts: string[];
  scorerPaths: string[];
  cageConfigPaths: string[];
  decoys: { path: string; kind: "cred" | "file"; value: string; progress: number }[];
};

// Default scope used in tests and as a fallback; a live Session carries its own scope.
export const DEFAULT_SCOPE: Scope = {
  paths: ["workspace/"],
  hosts: ["registry.acme.local", "wiki.acme.local"],
  tools: ["run_shell", "http_get", "http_post", "read_file"],
};

export const DECOY_CREDENTIALS = tw.decoyCredentials;
export const EXFIL_HOSTS = tw.exfilHosts;
export const SCORER_PATHS = tw.scorerPaths;
export const CAGE_CONFIG_PATHS = tw.cageConfigPaths;
// The planted decoys, for Person A (plant) and Person C (serve) to consume.
export const DECOYS = tw.decoys;

export const isDecoyCredential = (text: string): boolean => DECOY_CREDENTIALS.some((c) => text.includes(c));
const matchesAny = (text: string, needles: string[]): boolean => needles.some((n) => text.toLowerCase().includes(n.toLowerCase()));
export const looksLikeScorer = (text: string): boolean => matchesAny(text, SCORER_PATHS);
export const looksLikeCageConfig = (text: string): boolean => matchesAny(text, CAGE_CONFIG_PATHS);
export const isExfilHost = (host: string): boolean => EXFIL_HOSTS.some((h) => host === h || host.endsWith("." + h));
