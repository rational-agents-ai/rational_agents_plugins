---
name: adr_format
description: "Define and enforce the canonical ADR (Architecture Decision Record) format — exactly three `##` sections: 1. Problem Space (the problem to solve), 2. Solution (the architecture design), 3. Plan (how to implement it). Two modes inferred from input: AUTHOR a new conforming ADR from a topic, or CONFORM an existing document into the format and report what it is missing. This is the format /adr-consensus:adr_consensus requires before it will review a document. Trigger when the user runs /adr-consensus:adr_format or asks for the ADR format/template, to write a new ADR, or to bring a doc into ADR shape."
argument-hint: "<topic to write about> | path:<EXISTING_DOC_PATH>"
---

# /adr-consensus:adr_format — the canonical ADR format

One format, two modes. The format exists so a human can read the document top to bottom,
and so `/adr-consensus:adr_consensus` can review it against a rubric that assumes exactly
these three sections — its pre-flight refuses any other shape.

```
/adr-consensus:adr_format <topic>                    # AUTHOR a new ADR
/adr-consensus:adr_format path:<EXISTING_DOC_PATH>   # CONFORM an existing document
```

**Mode is inferred from the input.** A `path:` argument (or any argument that resolves to
an existing file) means CONFORM. Anything else is a topic — AUTHOR. If the input is
ambiguous, ask which one rather than guessing; reshaping a document the user only wanted
described is destructive.

## The format

### Document head

```markdown
# ADR: <SHORT_NAME> — <One-line statement of what this decides>

**Status:** PROPOSED | ACCEPTED | APPROVED | DRAFT | SUPERSEDED | REJECTED
**Date:** YYYY-MM-DD
```

The `**Status:**` line tells every reader, at a glance, whether the decision is still
open. Keep it in the first lines of the document.

### The three sections — mandatory, exact, in this order

```markdown
## 1. Problem Space
## 2. Solution
## 3. Plan
```

Exactly these three `##` headings, exactly this wording and order. Not two, not four. No
`## Summary`, no `## Appendix`, no `## Glossary` — anything that is not one of the three
either belongs inside one of them or does not belong in the ADR.

| Section | Answers | Must NOT contain |
|---|---|---|
| **1. Problem Space** | What is wrong now, who it hurts, what constrains a fix, and which alternatives lost and why | The chosen design |
| **2. Solution** | The design that was chosen, how it works, what it changes, and what it costs | The delivery sequence |
| **3. Plan** | How the design gets built and shipped, in dependency order | Re-argument of the design |

**Options considered belongs in section 1, not section 2.** The alternatives frame why a
decision was needed; only the chosen one is the design. Name each rejected option and why
it lost — that is the first thing an architecture reviewer asks.

**Risks, trade-offs, and consequences belong in section 2.** They are what the design
costs, so they sit beside it.

### Subsection menu (H3)

Prefer these names; reviewers and readers know where to look for each:

| Under `## 1. Problem Space` | Under `## 2. Solution` | Under `## 3. Plan` |
|---|---|---|
| `### Context` | `### Decision` | `### Phased Delivery Plan` |
| `### Current State` | `### Architecture` | `### Migration` |
| `### Decision Drivers` | `### Data Model` | `### Testing Strategy` |
| `### Constraints` | `### API Contracts` | `### Rollback Plan` |
| `### Options Considered` | `### Risks and Trade-offs` | `### Open Questions` |

The menu is guidance, not a cage. A real ADR needs headings nobody anticipated — an
abuse-control or cost section, a compliance section. **Add subsections freely when the
content demands it**; a subsection belongs to the `##` section above it. Prefer a menu
name when one genuinely fits; invent one when none does.

Go no deeper than H3 for structure. `####` and below are fine for detail but never carry
a section boundary.

### Formatting rules

- **Never wrap the whole document in a code fence.** A leading ` ```md ` hides every
  heading from anything that reads the structure, the format check included.
- Code fences inside the body are fine and expected. A `#` comment inside a fence is code,
  not a heading.
- Use real markdown headings (`## `), never bold text standing in for a heading.
- One H1 only — the title.

## AUTHOR mode

1. **Gather what you need.** Write only what the user has actually established. Where a
   decision has not been made, put it under `### Open Questions` in section 3 rather than
   inventing an answer. If a genuine fork blocks drafting, ask.
2. **Draft all three sections.** Every section must have real content. An ADR whose
   section 2 is a placeholder is not an ADR.
3. **Choose the file path.** Default to `docs/<SHORT_NAME>.md` relative to the project
   root (`git rev-parse --show-toplevel`, or the working directory outside git), upper
   snake case (`PAYMENTS_RETRY.md`, `WEB_SOCKET_IMPL.md`). Confirm before overwriting
   anything that exists.
4. **Verify the format** before declaring done:
   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/skills/adr_consensus/scripts/preflight.py" --check-format <NEW_ADR_PATH>
   ```
   It is read-only — it runs only the format validation `/adr-consensus:adr_consensus`
   enforces, never touches git, and exits non-zero with the missing or out-of-order
   sections named. Fix and re-run until it exits zero.
5. **Offer the review. Do not run it.** Say the ADR is ready and that
   `/adr-consensus:adr_consensus file:<PATH>` will review it for implementation
   readiness. A fresh draft usually wants human review first, and a consensus run costs
   up to 4N + 1 agents. Note that the review requires the document to be in a git
   repository.

## CONFORM mode

Given an existing document, report how far it is from the format and restructure it.

1. **Read it.** For a large document, get a fence-aware outline first rather than opening
   it blind:
   ```bash
   awk '/^[[:space:]]*(```|~~~)/ {f=!f; next} !f && /^#{1,3} / {print NR": "$0}' <PATH>
   ```
   Then read only the ranges you need, at most 800 lines per call.
2. **Map every existing heading** into problem / solution / plan, using the section table
   above.
3. **Report the gap before changing anything** — which of the three sections exist, which
   are missing, and what content has no home. Keep it to a few lines.
4. **Restructure**, preserving content. Move sections under the right H2, rename headings
   to menu names where one fits, add the `**Status:**` line if absent.
5. **Never invent a missing section.** This is the hard rule. If a document has no design,
   section 2 cannot be written from the requirements — that is fabricating architecture
   nobody proposed. Say the section is empty and why. A missing *plan* is different: a
   delivery sequence is genuinely implied by a design, so one may be derived in dependency
   order (data model → services → endpoints → UI → tests and rollout) **only if**
   labelled as derived and not stated by the document.
6. **Confirm before writing.** Show what you will change and get agreement — conforming
   rewrites an existing file. Then verify with the same `--check-format` command, and
   offer `/adr-consensus:adr_consensus`.

Many documents are simply not ADRs — requirements lists, test plans, runbooks, status
snapshots, API references. Say so plainly instead of forcing three sections onto them. A
test plan with no design is not improved by an empty Solution heading.

## Keeping the contract intact

The three headings are a shared contract with `/adr-consensus:adr_consensus`: its
pre-flight (`preflight.py`, `REQUIRED_SECTIONS`) checks for exactly `## 1. Problem
Space`, `## 2. Solution` and `## 3. Plan`, in that order, and its reviewer rubric assumes
them. Change the headings here and that check together, or documents written to this
format will be refused.
