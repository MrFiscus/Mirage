const http = require("http");
const fs = require("fs");
const path = require("path");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const { greet } = require("./lib.cjs");
const srv = http.createServer((req, res) => {
  if (req.url === "/health") return res.end(JSON.stringify({ ok: true, app: cfg.name }));
  res.end(greet(cfg.name));
});
srv.listen(Number(process.env.PORT || 0), "127.0.0.1", () => console.log("listening " + srv.address().port));
