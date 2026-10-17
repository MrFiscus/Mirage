const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { add, greet } = require("./lib.cjs");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
assert.strictEqual(add(2, 3), 5);
assert.strictEqual(greet("x"), "hello x");
assert.ok(cfg.name && cfg.maxConnections > 0, "config must define name and maxConnections");
console.log("tests ok");
