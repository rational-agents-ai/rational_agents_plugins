---
name: adr_consensus
description: "Drive an ADR (Architecture Decision Record) to implementation-readiness through multiple rounds of independent review, revision and consistency checking, ending in a plain-language READY / NEEDS_DECISION / NOT_READY verdict. Four seats — two reviewers (a codebase-grounded lens and an outside/adversarial lens), an architect who revises or rebuts, and a sweeper who keeps the document consistent — each filled by this plugin's seat agent on an Anthropic model (opus, fable, sonnet, haiku) chosen per seat: per-run flags (reviewer1:, reviewer2:, architect:, sweeper:) override the project's quorum.json from /adr-consensus:quorum_select, which overrides the defaults. An arbiter on the session model writes the verdict document. Refuses to launch unless the ADR is in the canonical three-section format and recoverable from a git commit. Accepts rounds:<N> (round cap, default 7) and churn:<N> (stop READY after N consecutive sweeper-only reopenings, default 2). Trigger when the user runs /adr-consensus:adr_consensus, or asks to review an ADR for implementation readiness, get consensus on whether an ADR is ready to build, or run the ADR review loop on a design document."
argument-hint: "file:<ADR_MARKDOWN> [rounds:<N>] [churn:<N>] [reviewer1:<model>] [reviewer2:<model>] [architect:<model>] [sweeper:<model>]"
---

# /adr-consensus:adr_consensus — drive an ADR to a readiness verdict

```
/adr-consensus:adr_consensus file:@docs/adr/PAYMENTS_RETRY.md     # relative, @ tolerated
/adr-consensus:adr_consensus file:PAYMENTS_RETRY                   # bare name, .md optional
/adr-consensus:adr_consensus file:PAYMENTS_RETRY.md rounds:3       # shorter run
/adr-consensus:adr_consensus file:PAYMENTS_RETRY.md sweeper:opus   # one seat's model, this run only
```

`file:` is the only required argument. Absolute, relative or bare; a leading `@`, `~`
and a missing `.md` are all tolerated. A bare name resolves within the project root. If
it matches more than one file, **ask which** — never pick.

This runs a **multi-agent loop that rewrites the ADR in place, once per round — up to 7
times by default.** Everything below exists so it never starts against the wrong
document, with the wrong configuration, or against one you cannot get back.

## Arguments

| Argument | Default | Meaning |
|---|---|---|
| `file:` | — (required) | The ADR |
| `rounds:` | `7` | Round cap — a **ceiling, not a quota**. The loop exits early on consensus, after two consecutive rounds with no movement, or on sweeper churn. Integer ≥ 1, else refused |
| `churn:` | `2` | Stop **READY** after N consecutive rounds where every reviewer was READY and only the confirming sweep reopened the round; the sweeper's open items are listed as consistency fixes, **not applied**. Integer ≥ 1, else refused |
| `reviewer1:` `reviewer2:` `architect:` `sweeper:` | from `quorum.json`, else defaults | That seat's model **for this run only** — never written back. One of `opus`, `fable`, `sonnet`, `haiku` (case-insensitive), else refused |

Validation is never coercion. `rounds:0`, `rounds:abc`, `rounds:2.5` or `reviewer1:gpt-4`
is refused with a reason and **nothing is launched** — never silently replaced with a
default. A user who typed `rounds:0` and got a normal 7-round run was overruled without
being told.

## Seats — the roles, and the model in each

| Seat id | Agent | Duty | Default model |
|---|---|---|---|
| `reviewer_1` | `adr-consensus:reviewer-grounded` | Readiness, checked against the project's code and docs. Never edits | `opus` |
| `reviewer_2` | `adr-consensus:reviewer-adversarial` | Readiness, attention on framing, assumptions and unexamined alternatives. Never edits | `fable` |
| `architect` | `adr-consensus:architect` | APPLY each docket item with the smallest scoped edit, or REBUT it | `sonnet` |
| `sweeper` | `adr-consensus:sweeper` | Whole-document consistency, scope trims, diff audit, escalation | `haiku` |
| arbiter | `general-purpose` (built-in) | Writes `<ADR dir>/<ADR stem>_CONSENSUS_VERDICT.md` explaining the computed verdict | the session's model — not configurable |

What each seat may and must do lives in its **contract** under this skill's `seats/`
directory (`reviewer.md`, `architect.md`, `sweeper.md`, `arbiter.md`); `seats/seats.json`
maps seat ids to agents and default models. **Any model may fill any seat**, including the
same model in all four. Both reviewer seats are always held, so consensus needs both
reviewers READY.

**Model resolution**, highest priority first: the per-run flag; then
`<project root>/.claude/adr-consensus/quorum.json` (written by
`/adr-consensus:quorum_select`); then the defaults above. `<project root>` is
`git rev-parse --show-toplevel` in the session's working directory, or that directory
itself outside git. A `quorum.json` seat value that is not one of the four models refuses
the run, naming the seat and the file — it never falls back silently.

Seats communicate only through structured artifacts the workflow passes between them
(findings → docket → revisions and rebuttals → edit-to-finding map → sweeper edits →
changes list → verdict). No seat messages another directly.

## Step 1 — pre-flight (always, no exceptions)

Translate the arguments the user gave into pre-flight flags **exactly as typed** — omit
any they did not give, never invent one:

| User gave | Pass |
|---|---|
| `file:<X>` | `"<X>"` (positional) |
| `rounds:<N>` | `--rounds "<N>"` |
| `churn:<N>` | `--churn "<N>"` |
| `reviewer1:<m>` `reviewer2:<m>` `architect:<m>` `sweeper:<m>` | `--reviewer1 "<m>"` `--reviewer2 "<m>"` `--architect "<m>"` `--sweeper "<m>"` |

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/adr_consensus/scripts/preflight.py" "<file>" --commit [flags]
```

Run it from the session's working directory. One call validates every flag and the
`quorum.json`, resolves the seat → model map, resolves the reference, verifies git,
validates the format, loads the seat contracts, and takes the backup. The checks gate the
commit, so a run that would fail to launch never leaves a commit behind. It prints JSON
and exits non-zero on any failure.

**If it exits non-zero, STOP.** Report the `reason` verbatim, do not launch the workflow,
and do not work around it:

| Failure | Why it blocks |
|---|---|
| Invalid `rounds:` / `churn:` | A non-integer cap would hold zero rounds and still emit a verdict — the worst failure, because it looks like a completed review |
| Invalid model flag or `quorum.json` value | The run would seat a model the operator did not choose. Name the seat and the file, offer `/adr-consensus:quorum_select` |
| Cannot resolve | Reviewing the wrong file reports a verdict about a document the user did not mean |
| **Ambiguous** — matches 2+ files | The script lists the matches. **Ask which**, never pick |
| Not in a git repository | The loop rewrites the document repeatedly. No git means no baseline commit, no diff to review and no clean revert. There is no non-git mode |
| Not the canonical format, or sections out of order | The rubric assumes `## 1. Problem Space`, `## 2. Solution`, `## 3. Plan`. Offer `/adr-consensus:adr_format` first |
| Seat contract missing | A seat with no contract has no defined duty |

On success keep `adr`, `repo`, `baseline_sha`, `seats`, `seat_models`, `max_rounds`,
`churn_limit`, `seat_map`, `branch`, `backup_action`, `restore_command`, `warnings` and
`worst_case_agents`. Before launching, tell the user the **branch** (it names the checkout
about to be rewritten), the **seat → model map** from `seat_map`, any `warnings`, and the
worst-case agent count.

**An untracked ADR is committed, not rejected.** When `backup_action` is
`committed-untracked`, say so: the restore command reverts the ADR's content, but the file
is now tracked, which it was not before the run.

## Step 2 — launch the workflow

Launch **this plugin's** workflow by its namespaced name — the bare name can start a
different workflow of the same name:

```
Workflow({
  name: "adr-consensus:adr-consensus",
  args: {
    adr: <adr>, repo: <repo>, baselineSha: <baseline_sha>,
    seats: <seats>, seatModels: <seat_models>,
    sustainQuorum: 1, maxRounds: <max_rounds>, churnLimit: <churn_limit>, revise: true,
    stateDir: "${CLAUDE_PLUGIN_DATA}/workflow-state"
  }
})
```

- `seats` and `seatModels` are passed **exactly as pre-flight returned them** (`seats`,
  `seat_models`) — never edited, summarised or rebuilt by hand. The workflow aborts
  without them.
- `baselineSha` is **required**; pass the sha pre-flight just returned. Never invent,
  shorten or reuse one from an earlier run.
- `maxRounds` and `churnLimit` are pre-flight's validated **numbers**, never strings.
- `stateDir` is where the sweeper writes its per-round snapshots, outside the
  repository: `${CLAUDE_PLUGIN_DATA}/workflow-state`.
- `revise: false` reports findings without editing the document — a read-only opinion.

## Step 3 — report

The workflow returns a `verdict` and writes `<ADR stem>_CONSENSUS_VERDICT.md` next to the
ADR (overwritten on every run of that ADR). Lead with the verdict, and never soften it:

| Verdict | What to tell the user |
|---|---|
| `READY` | Consensus reached. It certifies the document is **buildable as written** — not that the design is correct or secure |
| `READY` with `stopReason: sweeper-churn` | Every reviewer judged it buildable, but the document is **not yet self-consistent**. List each `consistencyFixes` entry as an edit to make by hand, and name any `unreviewedEdits`. Never present this as a clean READY |
| `NEEDS_DECISION` | The panel finished, but N disputes need **their** ruling. Present both sides at equal weight; do not pick a winner |
| `NOT_READY` | Say plainly what an engineer would actually hit, not how many findings survived |
| `ABORTED` | The workflow refused to start. Report why |

Always surface: the **verdict document path**; the fact that **the ADR on disk is no
longer what they last read**; the **restore command**; and the **seat → model map that
ran** (each seat id, its agent and model, and that the arbiter used the session model).

If the run stopped at the round cap with findings still live, say so explicitly. A
cap-out is not evidence the document is close to ready.

## What this skill must not do

- **Never launch without a successful pre-flight.** Up to 4N + 1 agents and an in-place
  rewrite of a design document are too expensive to spend on an unvalidated target.
- **Never write `quorum.json`.** Per-run model flags apply to this run only; only
  `/adr-consensus:quorum_select` writes the file.
- **Never commit anything but the ADR itself.** Pre-flight is path-scoped and never uses
  `git add -A`, `git add .` or `commit -a`. Do not commit on its behalf if it declines to.
- **Never push, branch, merge or reset.** The backup is a local commit.
- **Never guess between ambiguous matches.** Ask.
- **Never substitute a default for a refused value.** A refused value is a question for
  the user, not a gap to fill.
- **Never edit the ADR yourself** before or during the run. The architect seat owns
  revisions and the sweeper seat owns scope trims and consistency fixes.
- **Never edit a seat contract mid-run**, and never pass contract text that did not come
  from pre-flight.

## Cost

Worst case **4N + 1 agents** for `rounds:<N>` — two reviewers, one architect and one
sweeper per round, plus a single arbiter. A confirming sweep that makes a substantive
edit costs one extra review round.

| Rounds | Worst-case agents |
|---|---|
| `rounds:1` | 5 |
| `rounds:3` | 13 |
| default `7` | 29 |
| `rounds:10` | 41 |

That is the **ceiling, not the estimate** — a run that converges at round 2 costs about
9 whatever the cap. Mention the ceiling when launching, and state it unprompted for any
`rounds:` above 10.
