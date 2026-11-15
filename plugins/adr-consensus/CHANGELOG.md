# Changelog

All notable changes to the `adr-consensus` plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-14

First release.

### Added

- `/adr-consensus:adr_consensus` drives an Architecture Decision Record (ADR) to an
  implementation-readiness verdict of `READY`, `NEEDS_DECISION` or `NOT_READY`. It runs
  rounds of independent review, scoped revision and whole-document consistency sweeps,
  then writes `<ADR stem>_CONSENSUS_VERDICT.md` beside the ADR.
- Run options: `file:` (required), `rounds:` (round cap, default 7), `churn:` (stop `READY`
  after N consecutive sweeper-only reopenings, default 2), and per-run seat models
  `reviewer1:`, `reviewer2:`, `architect:` and `sweeper:`.
- Pre-flight checks that refuse to launch, with a reason, on an invalid flag or
  `quorum.json` value, an unresolvable or ambiguous ADR reference, an ADR outside a git
  repository, or an ADR not in the canonical three-section format. Refused values are
  never replaced with defaults.
- A path-scoped baseline commit of the ADR before the first round, with a printed restore
  command. The run never pushes, branches, merges or resets.
- Four seat agents, each filled by any of `opus`, `fable`, `sonnet` or `haiku`:
  `reviewer-grounded` (readiness checked against the codebase and documents, default
  `opus`), `reviewer-adversarial` (framing, assumptions and alternatives, default `fable`),
  `architect` (applies a scoped edit or rebuts each objection, default `sonnet`) and
  `sweeper` (consistency, scope trims and diff audit, default `haiku`). An arbiter on the
  session model writes the verdict document; the verdict itself is computed.
- Seat contracts and a seat map (`seats.json`) defining what each seat may and must do.
- The `adr-consensus:adr-consensus` workflow that runs the review loop.
- `/adr-consensus:adr_format`, which writes a new ADR, or reshapes an existing document,
  into the canonical format: `## 1. Problem Space`, `## 2. Solution`, `## 3. Plan`.
- `/adr-consensus:quorum_select`, which asks which model fills each seat and saves the
  choice to `<project root>/.claude/adr-consensus/quorum.json`. Per-run flags override it
  for that run only.

[0.1.0]: https://github.com/rational-agents-ai/rational_agents_plugins/releases/tag/adr-consensus-v0.1.0
