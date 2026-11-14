# replicants

A generic engineering loadout for human-in-the-loop work: role-based agents and task skills
that bind themselves to whatever repository Claude Code is running in.

## How it adapts to your project

Every agent starts each task the same way: it finds the project root (`git rev-parse
--show-toplevel`, else the working directory), reads `CLAUDE.md` as the authoritative source of
conventions and prohibitions, and probes the repository — stack, test runner, lint, build and
deploy setup — before acting. A script that exists but runs nothing is treated as absent, and no
agent invents a command, path, port, service or credential it did not find.

## Agents

Invoke with `@agent-replicants:<name>`, or let Claude delegate to them.

| Agent | Role |
|---|---|
| `replicants:codie` | Implements, refactors and debugs to Coding Excellence standards; reports pass/fail per acceptance criterion and leaves independent verification to `qa` |
| `replicants:analyst` | Read-only investigation: requirements, assumptions, alternatives, "is X built and where"; can fan out to `analyst-worker` |
| `replicants:analyst-worker` | Read-only slice worker for `analyst` |
| `replicants:qa` | Verifies criteria from your prompt, `CLAUDE.md` or the code's contracts by running the project's real tests; can fan out to up to five `qa_worker`s; reports evidence per criterion |
| `replicants:qa_worker` | Report-only test-slice worker for `qa` |
| `replicants:architect` | Designs and writes ADRs and design documents; read-only on source code |
| `replicants:deploy` | Containers, CI/CD and infrastructure-as-code for whatever the project already uses; plans before applying and asks before anything destructive |

Agents use explicit built-in tool allowlists and no MCP tools. Agents described as read-only
are instructed not to mutate anything, but those with shell access are not technically prevented
from doing so — use Claude Code permissions for hard limits.

## Skills

| Skill | What it does |
|---|---|
| `/replicants:qa` | Repeatable QA pass: derive criteria, run the project's tests, report PASS/FAIL per criterion with evidence |
| `/replicants:ce` | Apply Coding Excellence standards while writing or reviewing code |
| `/replicants:confirm_deny` | Check every assumption in your prompt and confirm, deny (with the correction) or mark it unresolved |
| `/replicants:cite_source` | Back every claim with a fresh lookup and a citation |
| `/replicants:qr` | Ask clarifying questions with recommendations before implementing |
| `/replicants:dont` | Read-only turn: advice only, and an approval gate before any change |
| `/replicants:verb` | A fully spelled-out, plain-language answer for this turn |

## Install

```bash
claude plugin marketplace add rational-agents-ai/rational_agents_plugins --scope project
claude plugin install replicants@rational-agents --scope project
```
