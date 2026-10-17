// The real store persists to <cwd>/data/runtime-state.json. Run tests in a throwaway copy of data/
// so they never touch the demo state or show up as incidents in the console.
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "batman-test-"));
cpSync(join(process.cwd(), "data"), join(dir, "data"), { recursive: true });
process.chdir(dir);
