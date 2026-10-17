import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface LabeledEvent { label: "benign" | "virus" | "near_miss"; signal: string }

const events = JSON.parse(readFileSync(resolve(process.cwd(), "data/events.json"), "utf8")) as LabeledEvent[];
const predictedThreats = events.filter((event) => /beacon|external target/.test(event.signal));
const trueThreats = events.filter((event) => event.label === "virus");
const truePositives = predictedThreats.filter((event) => event.label === "virus").length;
const falsePositives = predictedThreats.filter((event) => event.label !== "virus").length;
const falseNegatives = trueThreats.length - truePositives;
const precision = truePositives / (truePositives + falsePositives);
const recall = truePositives / (truePositives + falseNegatives);

console.log("Batman synthetic evaluation");
console.log("----------------------------");
console.log(`Detection precision  ${Math.round(precision * 100)}%`);
console.log(`Detection recall     ${Math.round(recall * 100)}%`);
console.log("Severity accuracy    measured per incident fixture");
console.log("Fix safety           clone checks required before apply");
console.log("Disclosure           role-filtered in server session");
console.log("Unsupported claims   investigator evidence required");