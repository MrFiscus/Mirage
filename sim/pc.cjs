// SIMULATED, HARMLESS setup and checks for "Robin's PC" in the Batman demo. Run with cwd = a sandbox app dir.
// Writes folders, logs and session lists under ./pc. Nothing here is malware or touches the network.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const USER = "robin.business@harvard.edu";
const SAMPLE = "BATMAN-DEMO-SAMPLE: harmless placeholder file written by the Batman demo. It is not malware; only this demo's local threat-intel list flags its hash.\n";
const QUARANTINE = "pc/quarantine/ObviousVirus.exe.quarantined";
const iso = (minAgo) => new Date(Date.now() - minAgo * 60_000).toISOString().replace(/\.\d+Z$/, "Z");
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const lines = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean) : []);

function setupFile() {
  const docs = {
    "pc/C/Business/Q3-Budget.xlsx": "Q3 budget (demo document)\n",
    "pc/C/Business/Vendor-List.csv": "vendor,contact\nAcme Paper,ap@acme.example\n",
    "pc/C/Business/Contracts/Lease-2026.pdf": "Lease agreement (demo document)\n",
  };
  for (const [p, c] of Object.entries(docs)) write(p, c);
  write("pc/.docs.sha256.json", JSON.stringify(Object.fromEntries(Object.keys(docs).map((p) => [p, sha(p)]))));

  const folders = [pick(["Q3-Reports", "Client-Files", "Finance-Share", "Projects"]), pick(["Vendor-Invoices", "Archive", "Old", "Scans"]), pick(["2026-10", "pending", "tmp-dl", "inbox"])];
  const rel = `pc/C/Business/${folders.join("/")}/ObviousVirus.exe`;
  const win = rel.replace(/^pc\/C\//, "C:/");
  write(rel, SAMPLE);

  write("pc/logs/downloads.log", [
    `${iso(1440)} download user=${USER} browser=msedge.exe url=https://sharepoint.example/sites/finance/Q3-Budget.xlsx saved=C:/Business/Q3-Budget.xlsx status=completed`,
    `${iso(300)} download user=${USER} browser=msedge.exe url=https://vendors.example/list.csv saved=C:/Business/Vendor-List.csv status=completed`,
    `${iso(2)} download user=${USER} browser=msedge.exe url=http://invoice-portal.example/download/Invoice_Q3.exe saved=${win} status=completed`,
  ].join("\n") + "\n");
  write("pc/logs/edr.log", [
    `${iso(900)} edr event=file_created host=ROBIN-PC user=${USER} process=excel.exe path=C:/Business/Q3-Budget.xlsx`,
    `${iso(2)} edr event=file_created host=ROBIN-PC user=${USER} process=msedge.exe path=${win} type=executable signed=false`,
  ].join("\n") + "\n");
  write("pc/logs/process.log", [
    `${iso(60)} process_start host=ROBIN-PC user=${USER} image=C:/Program Files/Microsoft Office/excel.exe parent=explorer.exe`,
    `${iso(5)} process_start host=ROBIN-PC user=${USER} image=C:/Program Files/Microsoft/Edge/msedge.exe parent=explorer.exe`,
  ].join("\n") + "\n");
  write("pc/policy/blocked-domains.txt", "malware-test.example\nphish-login.example\n");
  console.log(JSON.stringify({ rel, win }));
}

function setupLogin() {
  const rows = [];
  for (let d = 30; d >= 1; d--) {
    rows.push(`${iso(d * 1440 + 120)} signin user=${USER} ip=198.51.100.24 loc=Cambridge,MA,US app=Outlook result=success mfa=satisfied`);
    if (d % 3 === 0) rows.push(`${iso(d * 1440 + 60)} signin user=${USER} ip=198.51.100.24 loc=Cambridge,MA,US app=Teams result=success mfa=satisfied`);
    if (d % 5 === 0) rows.push(`${iso(d * 1440 + 30)} signin user=maya.ceo@harvard.edu ip=198.51.100.31 loc=Boston,MA,US app=Outlook result=success mfa=satisfied`);
  }
  rows.push(`${iso(41)} signin user=${USER} ip=198.51.100.24 loc=Cambridge,MA,US app=Teams result=success mfa=satisfied`);
  rows.push(`${iso(1)} signin user=${USER} ip=203.0.113.77 loc=Reykjavik,IS app=OutlookWeb result=success mfa=push_approved`);
  write("pc/logs/signin.log", rows.join("\n") + "\n");
  write("pc/logs/idp-alerts.log", `${iso(1)} idp_risk user=${USER} risk=unfamiliar_sign_in_properties ip=203.0.113.77 app=OutlookWeb\n`);
  const sessions = [
    `session=s-41a2 user=${USER} ip=198.51.100.24 app=Teams started=${iso(41)}`,
    `session=s-9c07 user=${USER} ip=203.0.113.77 app=OutlookWeb started=${iso(1)}`,
    `session=s-1b33 user=maya.ceo@harvard.edu ip=198.51.100.31 app=Outlook started=${iso(90)}`,
    `session=s-77de user=jordan.analyst@harvard.edu ip=198.51.100.40 app=Teams started=${iso(30)}`,
  ];
  write("pc/state/sessions.txt", sessions.join("\n") + "\n");
  write("pc/.others.json", JSON.stringify({ others: sessions.filter((s) => !s.includes(`user=${USER}`)).length }));
  write("pc/policy/disabled-accounts.txt", "");
  write("pc/policy/password-reset-required.txt", "");
  console.log(JSON.stringify({ ok: true }));
}

function checkFile(rel) {
  const base = JSON.parse(fs.readFileSync("pc/.docs.sha256.json", "utf8"));
  const docsOk = Object.entries(base).every(([p, h]) => fs.existsSync(p) && sha(p) === h);
  const q = fs.existsSync(QUARANTINE) ? fs.statSync(QUARANTINE) : null;
  return [
    { name: "File removed from Robin's folder", passed: !fs.existsSync(rel) },
    { name: "File quarantined and locked", passed: Boolean(q && (q.mode & 0o777) === 0) },
    { name: "Download source blocked", passed: lines("pc/policy/blocked-domains.txt").includes("invoice-portal.example") },
    { name: "Robin's other files unchanged", passed: docsOk },
  ];
}

function checkLogin() {
  const sessions = lines("pc/state/sessions.txt");
  const others = JSON.parse(fs.readFileSync("pc/.others.json", "utf8")).others;
  return [
    { name: "Robin's sign-in disabled", passed: lines("pc/policy/disabled-accounts.txt").includes(USER) },
    { name: "All of Robin's sessions signed out", passed: !sessions.some((s) => s.includes(`user=${USER}`)) },
    { name: "Other users' sessions untouched", passed: sessions.filter((s) => !s.includes(`user=${USER}`)).length === others },
    { name: "Password reset required at next sign-in", passed: lines("pc/policy/password-reset-required.txt").includes(USER) },
  ];
}

const [mode, arg] = process.argv.slice(2);
if (mode === "file") setupFile();
else if (mode === "login") setupLogin();
else if (mode === "check-file") console.log(JSON.stringify({ checks: checkFile(arg) }));
else if (mode === "check-login") console.log(JSON.stringify({ checks: checkLogin() }));
else { console.error("usage: pc.cjs file|login|check-file <rel>|check-login"); process.exit(2); }
