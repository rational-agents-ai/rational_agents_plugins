# Changelog

All notable changes to the `replicants` plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-14

First release.

### Added

- Seven role-based engineering agents that bind themselves to the repository Claude Code
  runs in. Each finds the project root, reads `CLAUDE.md` as the authority on conventions,
  and probes the stack, test runner, lint, build and deploy setup before acting. A script
  that runs nothing is treated as absent, and no agent invents a command, path or
  credential it did not find.
  - `replicants:codie` implements, refactors and debugs to Coding Excellence standards.
  - `replicants:analyst` investigates read-only and can fan out to at most five
    `replicants:analyst-worker` subagents.
  - `replicants:qa` verifies criteria by running the project's real tests and can fan out
    to at most five report-only `replicants:qa_worker` subagents.
  - `replicants:architect` designs and writes ADRs and design documents.
  - `replicants:deploy` handles containers, CI/CD and infrastructure-as-code, planning
    before applying and asking before anything destructive.
- Every agent has an explicit built-in tool allowlist and no MCP tools. Workers never
  spawn further agents.
- Seven skills:
  - `/replicants:qa` runs a repeatable QA pass and reports PASS/FAIL per criterion with
    evidence.
  - `/replicants:ce` applies Coding Excellence standards while writing or reviewing code.
  - `/replicants:confirm_deny` checks every assumption in the prompt and confirms it,
    denies it with the correction, or marks it UNRESOLVED.
  - `/replicants:cite_source` backs every claim with a fresh lookup and a citation, for one
    turn or, with `on` / `off`, for the rest of the conversation.
  - `/replicants:qr` asks clarifying questions with recommendations before implementing.
  - `/replicants:dont` makes a turn read-only and puts any implied change behind an
    approval gate.
  - `/replicants:verb` gives a fully spelled-out, plain-language answer for one turn.

[0.1.0]: https://github.com/rational-agents-ai/rational_agents_plugins/releases/tag/replicants-v0.1.0
