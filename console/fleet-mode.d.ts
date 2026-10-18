// Types for console/fleet-mode.js, so the server-side unit test can import it under strict TypeScript.
export type FleetModeId = "live" | "demo";
export interface FleetModeOption { id: FleetModeId; name: string; split: string; detail: string }
export interface AttackerBadge { kind: "live" | "simulated" | "unknown"; text: string }
export interface Cohort { kind: AttackerBadge["kind"]; label: string; agents: number; crossed: number; text: string }

export const FLEET_MODES: FleetModeOption[];
export const DEMO_ROGUE_SCENARIO: string;
export const LIVE_SCENARIO: string;
export function modeById(id: string): FleetModeOption | undefined;
export const HOST_NAMES: string[];
export const HOST_DOMAIN: string;
export function hostnameFor(index: number): string;
export function modeSplit(mode: string, n: number): { live: number; simulated: number };
export function launchPath(mode: string, n: number, watcherOff?: boolean): string;
export function launchPaths(mode: string, n: number, watcherOff?: boolean): string[];
export function attackerBadge(attacker: unknown): AttackerBadge;
export function cohortSummary(boxes: { attacker?: unknown; mirage: number; block: number }[]): Cohort[];
export function loopDepthFromActions(actions: { cmd: string; decision: string }[]): number;
export interface CompareSide { label: string; value: string; note: string }
export function compareSummary(
  on: { realOutOfScope: number | null } | null,
  off: { realOutOfScope: number | null } | null,
): { on: CompareSide | null; off: CompareSide | null };
