# adr-consensus

Drive an Architecture Decision Record (ADR) to an implementation-readiness verdict —
`READY`, `NEEDS_DECISION` or `NOT_READY` — through repeated rounds of independent review,
scoped revision and whole-document consistency sweeps, using a review quorum of Anthropic
models that you map per project.

## Skills

| Skill | What it does |
|---|---|
| `/adr-consensus:adr_consensus file:<ADR> [rounds:<N>] [churn:<N>] [reviewer1:<model>] [reviewer2:<model>] [architect:<model>] [sweeper:<model>]` | Runs the review loop on one ADR and writes a plain-language verdict document next to it |
| `/adr-consensus:adr_format <topic>` or `/adr-consensus:adr_format path:<doc>` | Writes a new ADR, or reshapes an existing document, into the canonical three-section format the review requires |
| `/adr-consensus:quorum_select` | Asks which model fills each review seat and saves the choice for this project |

## The quorum

| Seat | Duty | Default model |
|---|---|---|
| Reviewer 1 | Readiness, checked against the codebase and supporting documents | `opus` |
| Reviewer 2 | Readiness, with attention on framing, assumptions and unexamined alternatives | `fable` |
| Architect | Answers every objection: applies the smallest scoped edit, or rebuts it with reasons | `sonnet` |
| Sweeper | Keeps the whole document self-consistent and every revision in scope | `haiku` |
| Arbiter | Writes the verdict document; the verdict itself is computed, not chosen | your session's model |

Any of `opus`, `fable`, `sonnet` and `haiku` may fill any seat, including the same model in
every seat. Choices are saved to `<project root>/.claude/adr-consensus/quorum.json`; a per-run
flag such as `sweeper:opus` overrides them for that run only.

All seats are Anthropic models. Different model tiers and two reviewer lenses reduce
anchoring, but they are not a review by a different model family.

## Requirements

- Claude Code with workflows available.
- `python3` on `PATH`.
- The ADR must live in a git repository and use exactly three `##` sections, in order:
  `## 1. Problem Space`, `## 2. Solution`, `## 3. Plan`. Run `/adr-consensus:adr_format` first if
  it does not.

## What a run changes

- Before the first round it **commits the ADR on its own** (path-scoped) as a recovery point,
  and prints the command that restores it.
- It **rewrites the ADR in place**, once per round, and writes
  `<ADR file stem>_CONSENSUS_VERDICT.md` beside it.
- It never pushes, branches, merges or resets.

`rounds:` (default 7) is a ceiling, not a quota: the run stops as soon as the panel reaches
consensus, stalls, or only the final consistency sweep keeps reopening it (`churn:`, default 2).
The worst case is 4 × rounds + 1 agent calls.

## Install

```bash
claude plugin marketplace add rational-agents-ai/rational_agents_plugins --scope project
claude plugin install adr-consensus@rational-agents --scope project
```
