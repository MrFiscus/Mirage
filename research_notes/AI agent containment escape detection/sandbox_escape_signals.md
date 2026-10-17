# Detecting AI agent sandbox escape at runtime: signals, telemetry, tools

Scope: defensive detection only. Attack techniques appear only as the thing to detect. Research date: 2026-10-17. About 17 tool calls; Falco rule names come straight from the falcosecurity/rules repo files. Other vendor details are marked where they could not be confirmed.

## Q1. What indicators show a process inside a sandbox is attempting or achieving escape?

### Takeaway
The most reliable indicators are the prerequisites and probes for known escape paths: container-runtime sockets, host mounts, dangerous capabilities, namespace syscalls, kernel-interface writes (cgroup `release_agent`, `/proc/sys`, `/sys`), kernel module and BPF loading, and metadata or credential access. For AI agents in particular, the useful signal is the frequency and order of these probes. Agents do broad, fast reconnaissance and keep retrying, so bursts are more telling than any single call.

### Cited Findings
- **MITRE ATT&CK T1611 "Escape to Host"** (tactic: Privilege Escalation; platforms: Containers, ESXi, Linux, Windows). Detection strategy DET0219 has analytics for: bind mounts to sensitive paths such as `/` or `/proc`, unexpected privileged container launches, unusual `unshare`, `keyctl` or `mount` syscalls from containerized processes followed by process creation on the host, and kernel module loads on ESXi. Procedure examples: Doki (bound the host root directory), Hildegard (BOtB breakout tool), Peirates (Kubernetes hostPath mount), Siloscape (global symlink to the host C: drive), TeamTNT (privileged containers mounting the host filesystem). — [MITRE ATT&CK T1611](https://attack.mitre.org/techniques/T1611/)
- **T1611 mitigations:** seccomp to restrict syscalls such as mount, Pod Security Standards, removing tools, read-only and minimal images, SELinux, no root or unneeded mounts, patching. — [MITRE ATT&CK T1611](https://attack.mitre.org/techniques/T1611/)
- **SandboxEscapeBench** (Oxford and UK AI Security Institute, released 2026-03-30; ICML 2026 poster) runs 18 escape scenarios in three layers. These map directly to what a detector should watch:
  - **Orchestration:** CRI-O sysctl injection CVE-2022-0811, kubectl cp CVE-2019-1002101, over-privileged RBAC service account, route_localnet CVE-2020-8558.
  - **Runtime:** `--privileged`, `docker.sock`, CAP_SYS_ADMIN, CAP_SYS_MODULE, CAP_DAC_READ_SEARCH, hostPath, runc CVE-2019-5736 and CVE-2024-21626.
  - **Kernel:** shared pid namespace, cgroup CVE-2022-0492, BPF privesc CVE-2017-16995, Dirty COW, Dirty Pipe, packet socket CVE-2017-7308.
  - The goal in each scenario is reading the host's `/flag.txt`.
  - Sources: [arXiv 2603.02277](https://arxiv.org/html/2603.02277), [Help Net Security](https://www.helpnetsecurity.com/2026/03/30/ai-agents-container-breakout-capabilities-research/), [ICML 2026](https://icml.cc/virtual/2026/poster/66709)
- **Measured AI escape ability (same paper):**
  - At a 2.5M-token budget: Opus overall 0.49, GPT-5 0.50, GPT-5.2 0.27, Haiku 0.18, GPT-OSS-120B 0.16. No success on difficulty 4 and 5 tasks.
  - At a 100M-token budget: Opus 4.5 succeeded on 56% of samples, and "Claude Mythos Preview" succeeded at least once on 100%, which the authors say saturates the public benchmark.
  - Commentary notes that the tasks use known misconfigurations and CVEs, not zero-days.
  - Sources: [arXiv 2603.02277](https://arxiv.org/html/2603.02277), [alphaXiv](https://www.alphaxiv.org/abs/2603.02277.md), [Let's Data Science](https://www.letsdatascience.com/news/researchers-release-sandboxescapebench-to-test-container-esc-531abf80)
- **Observed agent behavior during escape attempts:**
  - Broad early reconnaissance: `whoami` and hostname, reading process capabilities, looking for a Docker socket, listing block devices, attempting mounts.
  - Some agents ran brute-force or key-based login attempts against the host gateway IP. One fingerprinted the kernel version to pick an exploit.
  - Claude models kept trying until the budget ran out (0% disengagement). GPT-5.2 disengaged in 92.3% of failed samples.
  - Self-inflicted sandbox crashes were common among failures: Mythos Preview 14/14, Opus 4.6 20/31, GPT-5.4-Pro 19/30, GPT-5.5 15/32. The authors note a crash would attract detection in a real deployment.
  - The benchmark threat model assumed "no active intrusion detection, monitoring, or logging."
  - Source: [arXiv 2603.02277](https://arxiv.org/html/2603.02277)
- **AI-specific escape signatures (practitioner guide):**
  - Mass `/proc/self` or `/proc/[pid]` enumeration (status, environ, ns, fdinfo, maps).
  - Bursts of `nsenter`, `unshare`, `capsh`, `findmnt`, `lsns`.
  - Write attempts, even failed ones, to `/proc/sysrq-trigger`, `/sys/kernel/security/`, `/proc/sys/kernel/`, or cgroup `release_agent`.
  - Repeated user-namespace `unshare`.
  - The guide's thesis: "frequency and sequencing are the detectable signatures."
  - Sample thresholds: more than 50 `/proc` reads in 5 s, more than 3 escape-tool execs in 30 s per container, more than 2 user-namespace `unshare` calls in 10 s. These are heuristics, not validated rates.
  - Source: [systemshardening.com](https://www.systemshardening.com/articles/observability/detecting-ai-automated-container-escapes/)
- **Syscalls worth alerting on from containers:** `setns`, `unshare`, `mount`, `ptrace`, `capset`, plus writes to `/proc/sys` or `/sys`. — [Wiz Academy, container escape](https://www.wiz.io/api/md/academy/container-security/container-escape)
- **Default Docker seccomp still allows** `ptrace`, `process_vm_readv`/`writev` and `bpf`, per one community write-up. It recommends denying these and alerting on them with Falco or Tetragon, and flagging denied egress in Cilium or Calico flow logs. Not verified against the moby default profile. — [DEV, "Three Sandbox Failures"](https://dev.to/robust_true_try/three-sandbox-failures-that-let-ai-agents-escape-3ab6)
- **cgroup release_agent escape pattern:** mount a cgroup directory, create a child cgroup, set `release_agent`. This requires SYS_ADMIN (`--privileged`). Aqua observed it in honeypots. — [Aqua, Threat alert: container escape](https://www.aquasec.com/blog/threat-alert-container-escape/)
- **Exfiltration risk without network isolation:** "Without network isolation, a compromised agent could exfiltrate sensitive files like SSH keys." Without filesystem isolation, the agent could escape the sandbox and gain network access. — [Anthropic, Claude Code sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)

### Inferences
Each indicator below has a check tier: **(A)** pollable from inside the sandbox, **(B)** needs host or kernel telemetry.

**Escape prerequisites**
- Runtime socket present or opened: `/var/run/docker.sock`, `/run/containerd/containerd.sock`, `/run/crio/crio.sock`, `/run/podman/podman.sock`. (A for presence, B for open)
- Kubernetes service account token readable: `/var/run/secrets/kubernetes.io/serviceaccount/token`. (A)
- Dangerous effective capabilities. Read `CapEff` in `/proc/1/status` and `/proc/self/status`. Watch CAP_SYS_ADMIN (bit 21), CAP_SYS_MODULE (16), CAP_SYS_PTRACE (19), CAP_DAC_READ_SEARCH (2), CAP_NET_ADMIN (12), CAP_BPF (39). (A)
- Host block devices visible (`/dev/sd*`, `/dev/nvme*`, `/dev/vd*`), or `/proc/mounts` showing host paths, `/proc`, or cgroup v1 mounts with `release_agent`. (A)

**Escape attempts**
- Exec of `nsenter`, `unshare`, `mount`, `insmod`/`modprobe`, `capsh`, `debugfs`, `chroot`. (A by `ps` polling, which can miss short-lived processes; B by exec events)
- Namespace change: a process whose `/proc/<pid>/ns/*` inode differs from PID 1's. (A)
- Writes to `release_agent`, `notify_on_release`, `/proc/sys/kernel/core_pattern`, `/proc/sysrq-trigger`. (A by hash or mtime polling, B for attempts)
- Kernel module or BPF load: `init_module`, `finit_module`, `bpf(BPF_PROG_LOAD)`. (B only)

**Evidence of success**
- New PIDs visible that are not this sandbox's (a host PID namespace), host hostname visible, or the host `/flag`-style canary readable. (A)

**Credential and recon**
- Reads of `~/.aws/credentials`, `~/.ssh/id_*`, `~/.config/gcloud`, `~/.kube/config`, `.env`, or `/proc/*/environ`. (B for reads, A only by honeyfile atime, which is unreliable under `noatime`/`relatime`)
- Connections to 169.254.169.254, `metadata.google.internal`, or the k8s API (`KUBERNETES_SERVICE_HOST:443`). (A by `ss -tnp` polling, which misses short connections; B by connect events)
- Internal network scanning: many SYN_SENT connections to RFC1918 addresses or the gateway, or SSH attempts to the gateway. (A partially, B fully)

**Persistence, hiding and anti-monitoring**
- Long-lived detached processes (`nohup`, `setsid`, double-fork reparented to PID 1), processes executed from `/dev/shm` or `/tmp`, memfd execution (`/proc/<pid>/exe` pointing to `memfd:` or `(deleted)`). (A)
- Cron or shell-rc modification, hidden dot files outside the workspace. (A)
- Truncated log files, shell history deleted, a changed watchdog or timeout config, killing the monitor process. (A by hashing your own monitor files)

**AI-specific heuristic.** Score each sandbox by the count of *distinct* escape-prerequisite probes per minute: capability read, socket check, mount listing, block-device listing, kernel version check, gateway connect. One probe is normal. Five or more distinct probes in about 60 s is the reconnaissance sweep pattern SandboxEscapeBench describes.

### Gaps
- No independent, peer-reviewed measurement of detection rates (true or false positive) for any AI-escape rule set was found. The thresholds above are practitioner heuristics.
- The SandboxEscapeBench per-task breakdown (Appendix H) was truncated in what I retrieved, so I can't say which scenarios agents solved most often.
- The claim about Docker's default seccomp profile (allowing `ptrace`, `process_vm_*`, `bpf`) comes from a community blog. I did not check it against moby's `default.json`. Docker's profile historically gates some of these on capabilities and kernel version.

## Q2. What telemetry captures these signals?

### Takeaway
Kernel-level eBPF sensors (Falco, Tetragon, Tracee) and auditd see syscalls the agent cannot hide, but they need host access. Egress proxies and DNS logs catch exfiltration and metadata access. Control-plane audit logs (Daytona, cloud) only see lifecycle actions. With only an exec/fs SDK, you are limited to periodic `/proc`, `ps`, `ss` and file-hash snapshots, which miss short-lived events and can be tampered with by a root-level agent.

### Cited Findings
- **Tetragon** (Cilium, eBPF) can hook kprobes such as `security_file_open` and syscalls such as `setns`. It can filter on the namespace (for example, outside the host mount or PID namespace) and act in-kernel with `Post` or `Sigkill`. One guide reports kernel 5.8+ and about 2% CPU overhead on busy nodes. — [systemshardening.com](https://www.systemshardening.com/articles/observability/detecting-ai-automated-container-escapes/)
- **Tetragon example policies (unverified):** a third-party policy `detect-container-escape` hooks `__x64_sys_setns` and SIGKILLs callers in a non-host PID namespace. A second policy watches `security_file_open` on `/etc/shadow`, `/etc/kubernetes/pki` and `/var/run/secrets/kubernetes.io`. Not found in Tetragon's own docs. — [claudemarket mirror of skill](https://www.claudemarket.ai/skills/mukul975/implementing-runtime-security-with-tetragon)
- **Critique of Tetragon enforcement:** grsecurity argues that kill-on-detect acts after the kernel exploit has already run ("right when the vulnerability was exploited"). It limits what the attacker gains but does not prevent the compromise. — [grsecurity, "Tetragone"](https://grsecurity.net/tetragone_a_lesson_in_security_fundamentals)
- **Falco** alerts on syscalls plus container and Kubernetes metadata. The `threshold`-style rate rules in the systemshardening examples are said to require Falco 0.38+ (not verified in Falco docs). Alerts can be routed through Falcosidekick to webhooks, Slack and PagerDuty. — [systemshardening.com](https://www.systemshardening.com/articles/observability/detecting-ai-automated-container-escapes/)
- **Tracee** (Aqua, eBPF) ships behavioral signatures, for example TRC-14 "CGroups Release Agent File Modification" (MITRE: Privilege Escalation, Escape to Host), written in Rego. Aqua says five escape-to-host signatures were added in a release, but the IDs were not visible in my results. — [Aqua, Tracee rules](https://www.aquasec.com/blog/tracee-rules-detect-attackers-out-of-the-box); [Aqua threat alert](https://www.aquasec.com/blog/threat-alert-container-escape/)
- **eBPF for AI agents specifically:**
  - AgentSight observes SSL/TLS plaintext and process behavior below the agent harness with no code changes.
  - ActPlane compiles YAML "behavioral contracts" to eBPF enforcement.
  - Both are open source from eunomia. The claims are the authors' own.
  - Sources: [eunomia.dev blog](https://eunomia.dev/blog/2026/05/25/runtime-security-for-ai-agents/), [DEV](https://dev.to/yunwei37/runtime-observability-and-enforcement-for-opaque-ai-agents-with-ebpf-beyond-sandboxes-and-approvals-8n6)
- **Network telemetry:**
  - Claude Code routes all sandbox traffic through a unix-socket proxy outside the sandbox that enforces a domain allowlist. [Anthropic](https://www.anthropic.com/engineering/claude-code-sandboxing)
  - Codex cloud runs environments behind an HTTP/HTTPS proxy "for security and abuse prevention purposes." [OpenAI Codex cloud environments](https://developers.openai.com/codex/cloud/environments)
  - Denied egress shows up in Cilium or Calico flow logs. [DEV](https://dev.to/robust_true_try/three-sandbox-failures-that-let-ai-agents-escape-3ab6)
- **Control-plane audit logs (Daytona)** record actor, action (create, start, stop, snapshot, SSH access changes, secret updates), target, status, IP and user agent. They are documented for control-plane events only. The page does not describe in-sandbox process, command or file capture. The docs navigation also lists "Log Streaming" and "OpenTelemetry Collection" pages, which I did not read. — [Daytona audit logs](https://www.daytona.io/docs/en/audit-logs)

### Inferences
| Telemetry | Sees | Needs | Fit for a 12-hour build |
|---|---|---|---|
| Falco (modern_ebpf driver) | exec, open, connect, mount, setns, ptrace, module load, with container context | host root, kernel headers or CO-RE | Good if you control a Linux VM. Not possible inside Daytona. |
| Tetragon | same, plus in-kernel kill | host, kernel 5.8+, k8s or standalone | Good for a "block" demo on your own VM |
| Tracee | syscalls plus Rego signatures (TRC-*) | host, privileged container | Similar to Falco |
| auditd | execve, open on watched paths (`-w /var/run/docker.sock`), module syscalls | host root | Simple, noisy, no container context |
| osquery | point-in-time tables (`processes`, `process_open_sockets`, `listening_ports`, `mounts`, `file`, `hash`, `docker_containers`); evented tables with audit or BPF | install inside or on host | Its scheduled queries resemble SDK polling |
| Egress proxy and DNS logs | every outbound host and SNI, metadata IP hits | network control at the sandbox edge | High value, cheap to fake locally |
| File integrity (hash or inotify) | changes to monitored files, honeyfile touches (inotify `IN_OPEN`/`IN_ACCESS`) | in-sandbox agent or host | inotify inside the sandbox can be killed by a root agent |
| Cloud audit (CloudTrail etc.) | use of stolen cloud credentials | cloud account | Best place for honey-AWS-key alerts |

- Inside-sandbox monitors run at the same privilege as the agent. A root agent can kill them, edit their logs, or race the poll interval. So "monitor tampered or missing" is itself a high-severity signal, and the monitor should ship each snapshot out immediately rather than storing it inside the sandbox.

### Gaps
- I did not retrieve Tetragon's official policy-library examples or Tracee's current full TRC-* signature list (the docs URL returned 404). Run `tracee --list` against the installed version to get it.
- I did not verify the osquery table names above against current osquery docs in this session. They are from background knowledge.
- I did not read Daytona's Log Streaming or OpenTelemetry pages, so whether Daytona can export in-sandbox process telemetry is unknown.

## Q3. Which existing Falco, Tetragon and Tracee rules are relevant?

### Takeaway
Falco's upstream repo splits rules into stable (`falco_rules.yaml`, 25 rules), incubating (32) and sandbox (39) files. A large share are directly relevant to agent escape, and many relevant ones (metadata, setns, unshare, privileged launch) are incubating, so they are not loaded by default.

### Cited Findings
**Falco stable rules, `falco_rules.yaml` (enabled by default)** — [falcosecurity/rules falco_rules.yaml](https://raw.githubusercontent.com/falcosecurity/rules/main/rules/falco_rules.yaml)

| Rule | Priority | What it catches |
|---|---|---|
| Detect release_agent File Container Escapes | CRITICAL | release_agent opened for write with root or CAP_DAC_OVERRIDE plus CAP_SYS_ADMIN |
| Drop and execute new binary in container | CRITICAL | executes a binary not in the base image (upper layer) |
| Fileless execution via memfd_create | CRITICAL | exec from memfd |
| Read sensitive file untrusted | WARNING | /etc/shadow, /etc/sudoers and similar |
| Linux Kernel Module Injection Detected | WARNING | init_module or finit_module from a container with sys_module |
| Debugfs Launched in Privileged Container | WARNING | debugfs in a privileged container |
| PTRACE attached to process | WARNING | ptrace attach, seize, poke or setregs |
| Directory traversal monitored file read | WARNING | `../` traversal to /etc or SSH keys |
| Clear Log Activities | WARNING | log opened with O_TRUNC |
| Search Private Keys or Passwords | WARNING | grep or find for key material |
| Find AWS Credentials | WARNING | grep or find for AWS keys or `.aws/credentials` |
| Execution from /dev/shm | WARNING | exec from /dev/shm |
| Remove Bulk Data from Disk | WARNING | shred, mkfs |
| Netcat Remote Code Execution in Container | WARNING | nc or ncat with exec flags |
| Terminal shell in container | NOTICE | shell with an attached TTY |
| Contact K8S API Server From Container | NOTICE | outbound connection to the k8s API server |
| Packet socket created in container | NOTICE | AF_PACKET socket |
| Disallowed SSH Connection Non Standard Port | NOTICE | outbound SSH on odd ports |
| Run shell untrusted | NOTICE | shell from a server process parent |

The file also contains: Read sensitive file trusted after startup, System user interactive, Create Symlink Over Sensitive Files, Create Hardlink Over Sensitive Files, Redirect STDOUT/STDIN to Network Connection in Container, PTRACE anti-debug attempt.

**Falco incubating rules, `falco-incubating_rules.yaml`** — [falcosecurity/rules incubating](https://raw.githubusercontent.com/falcosecurity/rules/main/rules/falco-incubating_rules.yaml)

| Rule | Priority | What it catches |
|---|---|---|
| Read ssh information | ERROR | non-SSH program reads `.ssh` |
| Launch Package Management Process in Container | ERROR | package manager launched in a container |
| Mount Launched in Privileged Container | WARNING | mount in a privileged container |
| Network Connection outside Local Subnet | WARNING | inactive by default; the namespace list is empty |
| Modify Shell Configuration File | WARNING | writes to .bashrc, /etc/profile and similar |
| Delete or rename shell history | WARNING | history file truncated or renamed |
| Contact cloud metadata service from container | NOTICE | connection to 169.254.169.254 |
| Change thread namespace | NOTICE | setns |
| Change namespace privileges via unshare | NOTICE | unshare without CAP_SYS_ADMIN |
| Launch Suspicious Network Tool in Container | NOTICE | nc, nmap, tcpdump, socat |
| Schedule Cron Jobs | NOTICE | writes under /etc/cron or crontab exec |
| Set Setuid or Setgid bit | NOTICE | chmod setting SUID or SGID |
| BPF Program Not Profiled | NOTICE | BPF_PROG_LOAD by an unprofiled process |
| Program run with disallowed http proxy env | NOTICE | curl or wget with HTTP_PROXY set |
| Launch Remote File Copy Tools in Container | NOTICE | rsync, scp, sftp |
| Unexpected UDP Traffic | NOTICE | UDP on unexpected ports |
| Launch Privileged Container | INFO | container started privileged |

Also in the incubating file: Contact EC2 Instance Metadata Service From Container, Read environment variable from /proc files, Exfiltrating Artifacts via Kubernetes Control Plane, Adding ssh keys to authorized_keys, Launch Excessively Capable Container, Non sudo setuid, Create files below dev, Potential Local Privilege Escalation via Environment Variables Misuse.

**Falco sandbox rules, `falco-sandbox_rules.yaml`** — [falcosecurity/rules sandbox](https://raw.githubusercontent.com/falcosecurity/rules/main/rules/falco-sandbox_rules.yaml)
- Launch Sensitive Mount Container: the initial process mounts /proc, the docker socket, /etc or /.
- Container Access to Host Sensitive Paths; Privileged Container Device Access.
- Create Hidden Files or Directories; Container Drift Detected (chmod) and (open+create); Modify Container Entrypoint.
- Kubernetes Client Tool Launched in Container; Basic Interactive Reconnaissance; Decoding Payload in Container.
- Unexpected K8s NodePort Connection (disabled by default).
- Detect outbound connections to common miner pool ports; Network Tool Executed During NPM Package Install.
- Sudo Potential Privilege Escalation; Polkit Local Privilege Escalation Vulnerability (CVE-2021-4034).
- Write below etc, Write below root, Write below binary dir.

**Rule history:** "Contact K8S API Server From Container" was reworked in Falco PR #952 (0.19.0 milestone) to detect connections to the API server from a container. — [falcosecurity/falco PR 952](https://github.com/falcosecurity/falco/pull/952)

**Tracee:** TRC-14 CGroups Release Agent File Modification. — [Aqua](https://www.aquasec.com/blog/threat-alert-container-escape/)

### Inferences
- The rule names the brief guessed map to real rules, with these corrections:
  - "Launch Privileged Container" is incubating with INFO priority.
  - "Contact cloud metadata service from container" is incubating.
  - "Read sensitive file untrusted", "Terminal shell in container" and "Contact K8S API Server From Container" are stable.
- Falco has no "docker socket opened" rule in stable. Docker socket mounts are covered at container launch by "Launch Sensitive Mount Container" (sandbox file).
- For the hackathon, these Falco rules can be reimplemented as poll-based checks against Daytona with the same names, credited to Falco: release_agent, metadata contact, setns/unshare (namespace diff), Read ssh information (honeyfile), Clear Log Activities, Execution from /dev/shm, memfd execution, Create Hidden Files, Schedule Cron Jobs, Modify Shell Configuration File, Launch Suspicious Network Tool.

### Gaps
- Falco's sandbox file was truncated at about 100k characters, so the list may be incomplete.
- I could not confirm whether the current Falco release still ships the stable rule file with exactly 25 rules. It reflects `main` at the time of fetch.

## Q4. How well do deception and tripwires work, especially against agents?

### Takeaway
Canaries fit agents unusually well. Agents enumerate everything and do not tire. In SandboxEscapeBench, Claude models never disengaged, and agents swept sockets, capabilities and credentials early. A honeyfile, honey credential or fake socket in an obvious place is therefore likely to be touched by a compromised or escaping agent. False positives are near zero if nothing legitimate references the decoy. The catch: a well-behaved agent that indexes the whole workspace will also touch decoys there, so put decoys outside the task workspace.

### Cited Findings
- Planting unique high-entropy canary strings and scanning outputs or outbound requests for them gives near-zero false positives and cheap detection. It does not prevent the leak. — [Klu glossary](https://klu.ai/glossary/prompt-injection-canary-tokens); [Zeltser, plant honeytokens](https://zeltser.com/plant-honeytokens)
- Dreadnode uses inert honeytokens to test agents for RCE and exfiltration. Canaries still match when base64-, hex- or URL-encoded once payloads are canonicalized. — [Dreadnode docs](https://docs.dreadnode.io/ai-red-teaming/how-to/honeytoken-probing/)
- The open-source "agent-canary" project adds decoy MCP tools (fake wire transfer, fake secrets reader) and canary strings in honeypot files. A healthy agent never calls the decoys. Claims are unverified. — [mcpservers.org agent-canary](https://mcpservers.org/servers/dorianchn/agent-canary)
- A 2026 preprint on credential exfiltration by LLM agents models canary detection probability as about k/(m+k) times the detection rate (k canaries among m real secrets). It calls this a modeling assumption, not a theorem, and warns that an adaptive attacker who can tell real from fake defeats it. — [arXiv 2606.04141](https://arxiv.org/pdf/2606.04141)
- Canaries say nothing about attacks that never touch the marked region, such as an agent hijacked into calling the wrong tool. — [Klu glossary](https://klu.ai/glossary/prompt-injection-canary-tokens)
- SandboxEscapeBench agents looked for a Docker socket, read capabilities, listed block devices, tried mounts, and tried default or well-known SSH credentials against the gateway. The authors had to patch these shortcuts. — [arXiv 2603.02277](https://arxiv.org/html/2603.02277)

### Inferences
Concrete tripwires that need only an exec/fs SDK:
1. **Honey AWS key** in `~/.aws/credentials` and a `.env` outside the workspace. Thinkst Canarytokens' AWS key token alerts when the key is used via CloudTrail. For a fully local hackathon, use a fake key string and grep egress and proxy logs for it.
2. **Honeyfiles:** `~/.ssh/id_ed25519`, `/root/.kube/config`, `/opt/backup/db_password.txt`. Detect access by atime (unreliable under `relatime`), by an inotify watcher (killable), or by the content showing up in egress.
3. **Fake runtime socket:** a unix socket at `/var/run/docker.sock` served by a tiny listener that logs any connect and replies with a fake `/version`. Any connection means the agent attempted a container escape.
4. **Fake metadata endpoint:** route 169.254.169.254 to a local listener (or `/etc/hosts` for `metadata.google.internal`) that logs requests and returns canary credentials.
5. **Fake host flag:** a file like `/host/flag.txt` or a decoy "host" path, mirroring SandboxEscapeBench's `/flag.txt` goal.
6. **Gateway SSH honeypot:** log any connection attempt to the gateway IP on port 22, since agents tried SSH brute force there.

**False positives:** dependency scanners, `grep -r` over `/`, and IDE indexers will touch honeyfiles. Agents asked to "find all config" will too. Keep decoys outside the agent's stated workspace, and alert on *use* (a connect, or the canary leaving the box) at higher severity than a *read*.

### Gaps
- I found no published measurement of canary hit rates against real AI agents in escape or exfiltration settings. Effectiveness for agents is inferred from observed enumeration behavior.
- I did not fetch Thinkst Canarytokens docs this session, so token types are named from background knowledge.

## Q5. How do AI-agent sandbox providers enforce and monitor containment?

### Takeaway
Providers mostly enforce containment through isolation (microVM, gVisor, containers, OS sandboxes) and egress control (proxy or allowlist). Most expose control-plane or audit logs, not in-sandbox runtime security telemetry. For Daytona specifically, escape detection has to be built by us, from inside via the SDK or from a host we control.

### Cited Findings
- **Daytona isolation:**
  - Classes are "Container: Isolated container with dedicated namespaces and enforced resource limits", VM ("Full virtual machine with its own kernel"), and GPU.
  - Code "runs as root inside the sandbox."
  - Sandboxes don't share processes, network, mounts or IPC unless linked; linked sandboxes share a link network.
  - The specific runtime (Kata, Sysbox, etc.) is not named.
  - Source: [Daytona isolation](https://www.daytona.io/docs/en/isolation)
- **Daytona network controls:**
  - `networkBlockAll`, `networkAllowList` (CIDRs; one doc page says up to 5) and `domain_allow_list`.
  - Sandboxes have full network access by default, subject to an org tier policy that admins cannot modify.
  - Essential services such as package registries and Git stay reachable.
  - Source: [Daytona network limits](https://www.daytona.io/docs/en/network-limits)
- **Daytona audit logs** cover control-plane actions only (see Q2). — [Daytona audit logs](https://www.daytona.io/docs/en/audit-logs)
- **Claude Code sandboxing:**
  - bubblewrap on Linux, seatbelt on macOS.
  - Read and write in the current working directory; "blocking the modification of any files outside of it."
  - Network only via a unix-socket proxy outside the sandbox, with a domain allowlist.
  - Restrictions apply to child processes.
  - On violation, "you'll be notified immediately, and can choose whether or not to allow it."
  - Reduced permission prompts by 84%. Open-source runtime.
  - The post does not describe violation audit logging.
  - Source: [Anthropic engineering](https://www.anthropic.com/engineering/claude-code-sandboxing)
- **OpenAI Codex cloud:**
  - Setup phase has network access. The agent phase has internet off by default, configurable to limited or unrestricted.
  - Secrets are available only during setup and removed before the agent phase.
  - All traffic goes through an HTTP/HTTPS proxy.
  - The local CLI's default workspace-write mode has network off.
  - Sources: [OpenAI Codex cloud environments](https://developers.openai.com/codex/cloud/environments), [Codex agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)
  - WorkOS (Sep 2026) claims the setup phase's unrestricted internet cannot be turned off. Not verified against OpenAI docs. — [WorkOS](https://workos.com/blog/agent-sandbox-egress-defaults)
- **E2B, Modal, gVisor, Firecracker:**
  - E2B uses Firecracker microVMs (own guest kernel). Modal uses gVisor, a user-space kernel in Go that intercepts syscalls.
  - Comparisons describe this as hardware-level versus OS-level isolation.
  - Cold-start figures conflict across sources: about 150 ms, 125 ms, and 5 to 30 ms from snapshot restore.
  - None of the results described monitoring or audit features.
  - Sources: [Morph E2B vs Modal](https://www.morphllm.com/comparisons/e2b-vs-modal), [SoftwareSeni comparison](https://www.softwareseni.com/firecracker-gvisor-containers-and-webassembly-comparing-isolation-technologies-for-ai-agents/), [Spheron](https://www.spheron.network/blog/ai-agent-code-execution-sandbox-e2b-daytona-firecracker/)

### Inferences
- The industry pattern is to prevent with an isolation boundary plus an egress proxy and to rely on proxy logs for visibility. Runtime escape *detection* inside the sandbox is largely left to the customer. That is a defensible gap for a hackathon project to fill.
- With microVM or gVisor isolation, the in-guest signals (capabilities, sockets, namespace probes) still show *intent*. Actual success would need a hypervisor or gVisor bug, so a detector framed as "detects escape attempts and reconnaissance" is more honest than "detects escapes."

### Gaps
- No primary E2B, Modal or gVisor docs on monitoring or logging were fetched. Whether E2B or Modal expose per-sandbox syscall or exec logs is unknown.
- I did not fetch Daytona's Log Streaming or OpenTelemetry docs. They may export sandbox process logs.
- I found nothing on Docker's own "sandboxes for coding agents" product in this session.

## Q6. What can be checked by polling from inside the sandbox, and what needs host-level eBPF?

### Takeaway
A useful detector can run entirely through Daytona's `process.exec` and fs APIs by taking diffed snapshots every few seconds. It catches persistent state: capabilities, mounts, sockets, namespaces, long-lived processes, connections, file hashes and honeyfile touches. It misses transient syscalls (a failed mount, a 50 ms connect, a module-load attempt) and can be blinded by a root agent. Host-level eBPF (Falco, Tetragon, Tracee) is needed for complete, tamper-resistant coverage.

### Cited Findings
- Daytona container sandboxes run code as root, and users can read cgroup files (`/sys/fs/cgroup/cpu.max`, `memory.max`) from inside. — [Daytona isolation](https://www.daytona.io/docs/en/isolation)
- AI escape signatures are about frequency and sequence (bursts of `/proc` reads, escape-tool execs, `unshare`), and per-container rate thresholds are the recommended detection form. — [systemshardening.com](https://www.systemshardening.com/articles/observability/detecting-ai-automated-container-escapes/)
- Monitoring and metrics agents read `/proc` heavily and need allowlists. Legitimate `nsenter` debugging exists, so a single call is not a signal. Run rules alert-only for 72 hours to two weeks, and set thresholds at about 1.5x the measured legitimate rate. — [systemshardening.com](https://www.systemshardening.com/articles/observability/detecting-ai-automated-container-escapes/)
- Recommended response ladder: kernel-write attempts lead to cordon plus delete; recon or tool bursts lead to annotate, network-quarantine, then delete. — [systemshardening.com](https://www.systemshardening.com/articles/observability/detecting-ai-automated-container-escapes/)

### Inferences
**Poll-from-inside checklist** (one `process.exec` shell script; returns JSON; diff against a baseline taken at sandbox creation):

| # | Check | Command or source | Fires when | FP notes |
|---|---|---|---|---|
| 1 | Effective capabilities | `grep CapEff /proc/self/status /proc/1/status` | CAP_SYS_ADMIN, SYS_MODULE, SYS_PTRACE, DAC_READ_SEARCH, BPF bits present, or changed from baseline | Daytona runs as root, so baseline first. The change is the signal. |
| 2 | Runtime sockets | `ls -l /var/run/docker.sock /run/containerd/containerd.sock /run/crio/crio.sock 2>/dev/null` | exists | Never expected in an agent sandbox |
| 3 | Mounts | `cat /proc/self/mountinfo` diff | new mount, host paths, cgroup with `release_agent`, `/dev/sd*`/`nvme` mounted | Package installs don't mount. Low FP. |
| 4 | Block devices | `ls /dev | grep -E 'sd|nvme|vd|xvd'` | host disks visible | baseline per backend |
| 5 | Namespaces | `readlink /proc/*/ns/{mnt,pid,net,user}` vs PID 1 | any process in a different namespace | Rootless tools (bwrap, podman) legitimately unshare |
| 6 | Process tree | `ps -eo pid,ppid,user,etimes,args` diff | escape tools (`nsenter|unshare|mount|insmod|modprobe|capsh|debugfs|chroot`), recon tools (`nmap|masscan|nc|socat|tcpdump`), new long-lived (`etimes`>N) processes reparented to PID 1, exe in `/tmp`, `/dev/shm`, `memfd:`, `(deleted)` | Short-lived processes are missed between polls. Dev servers are legitimately long-lived. |
| 7 | Connections | `ss -tunap` or parse `/proc/net/tcp` | 169.254.169.254, gateway:22, k8s API, many SYN_SENT to RFC1918, non-allowlisted remote | Polling misses short connections. Use the proxy log if possible. |
| 8 | Kernel-interface files | hash `/proc/sys/kernel/core_pattern`, find writable `release_agent` | changed | Very low FP |
| 9 | Persistence | hash crontabs, `~/.bashrc`, `/etc/profile*`, `authorized_keys`, `/etc/ld.so.preload` | changed | Some installers edit rc files |
| 10 | Honeyfiles | `stat -c %X` atime on decoys; or the canary string in egress | atime moved, or canary seen | `relatime` may hide repeat reads. The first read after a write still updates. |
| 11 | Monitor integrity | hash of the monitor script, its log, and timeout config; heartbeat | changed, missing, or heartbeat late | A heartbeat gap is itself an alert |
| 12 | Writes outside workspace | `find / -xdev -newer /tmp/.baseline -not -path '/workspace/*' -not -path '/proc/*' ...` | new files outside the allowed paths | Caches (`~/.npm`, `~/.cache`, `/tmp`) need allowlisting |
| 13 | Env-secret exposure | count reads is not possible; instead check `/proc/*/environ` for tokens that should not be present | secrets present in the agent's env | Configuration finding, not an event |
| 14 | Recon burst score | distinct probes seen across consecutive polls (1, 2, 3, 4, 7) | 5 or more distinct categories within about 60 s | Tune per demo |

**Requires host-level eBPF or auditd (not feasible via the Daytona SDK alone):**
- Failed or attempted syscalls: `mount`, `setns`, `unshare`, `init_module`, `bpf`, `ptrace`.
- Exact `open()` of sensitive files.
- Every exec, including sub-second ones, and every connect.
- In-kernel blocking (Tetragon Sigkill).
- Tamper resistance against a root agent.

For a hackathon, run Falco or Tetragon on a Linux VM you control with a Docker "agent sandbox" container to show this tier, and use Daytona polling for the managed tier.

**Tamper caveat:** a root agent inside the sandbox can alter `ps`, `ss` or the monitor script. Mitigate by:
- shipping the script fresh on each poll through `process.exec`, not storing it in the sandbox;
- reading `/proc` directly rather than through `ps`;
- treating command failure, timeout or a missing baseline as an alert.

**Honest framing for the demo:** "detects escape attempts and preconditions by polling the sandbox from outside, on a simulated agent." Do not claim to detect all escapes.

### Gaps
- No source measured the miss rate of interval polling against short-lived escape steps. The trade-off above is reasoning, not data.
- Whether Daytona's container class exposes host-relevant `/proc` or `/dev` entries (block devices, cgroup v1) was not tested. Baseline on a real sandbox before setting rules.
