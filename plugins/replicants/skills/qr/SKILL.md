---
name: qr
description: Before implementing, ask clarifying questions and make best-practice recommendations — both with rationale provided. Uses the AskUserQuestion tool to present questions and recommendations together as selectable options, recommended choice first. Trigger when the user runs /replicants:qr, or asks for clarifying questions and recommendations before work starts.
---

# /replicants:qr — clarifying questions and recommendations, before implementing

Before proceeding with any implementation, you MUST gather the open questions and best-practice
recommendations, then present them through the **AskUserQuestion** tool so the user can decide in
one pass.

## 1. Gather questions and recommendations

Review the requirements and design of the task. Identify two things:

- **Clarifying questions** — every area of ambiguity, uncertainty or missing information where
  assuming wrong would send the work in the wrong direction.
- **Best-practice recommendations** — for each decision, the approach you would recommend and why
  (trade-offs, risks of the alternatives, patterns already used in this codebase).

Do NOT ask questions that can be answered by reading the existing codebase, git history or the
prompt itself. Investigate first (read files, run searches, inspect state) and only surface what
is genuinely undecided. A good `/replicants:qr` pass is grounded in facts you already verified.

## 2. Present via AskUserQuestion — questions AND recommendations together

Use the **AskUserQuestion** tool. Fold your recommendation INTO each question rather than listing
recommendations separately:

- Turn each decision into one question (`header` ≤ 12 characters, e.g. "Approach", "Auth",
  "Scope").
- Make your **recommended choice the FIRST option** and append **" (Recommended)"** to its label.
- Put the **rationale in each option's `description`** — why this option, and the trade-off of
  choosing it. Every option a reader sees should explain what picking it means.
- Add the genuine alternatives as the other options (2–4 in total per question). The tool adds an
  "Other" escape hatch automatically — do not add your own.
- Use `multiSelect: true` when the choices are not mutually exclusive.
- Use the `preview` field when options are concrete artifacts worth comparing side by side (UI
  mock-ups, code snippets, config variants) — not for plain preference questions.

The tool accepts **1–4 questions per call**. With more than four decisions, lead with the most
consequential four; once those are answered you can ask another round. Order questions by impact.

### When prose context is needed first

If a decision needs richer rationale than fits in option descriptions (current state you
discovered, a comparison table, a constraint you found), write a short preamble BEFORE the
AskUserQuestion call, then let the tool carry the decisions. Keep the preamble tight — facts and
the fork, not a survey.

### Recommendations with no real fork

If something is a flat recommendation with no genuine alternative, you can still frame it as a
confirm question (recommended option first, plus a "do it differently" alternative) so the user can
veto — or state it in the preamble and let your other questions carry the gate.

## 3. Await the answers

AskUserQuestion blocks until the user responds — do not begin implementation, write code or make
changes until you have their answers. If the task genuinely has zero open decisions, say so plainly
and confirm the recommended plan before proceeding rather than inventing questions.
