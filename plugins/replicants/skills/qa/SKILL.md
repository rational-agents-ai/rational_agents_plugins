---
name: qa
description: Repeatable QA procedure for the current project — derive the acceptance criteria (from the prompt, CLAUDE.md, or the code's own contracts), identify and run the project's real test runner without being told which, and report PASS/FAIL per criterion with evidence. A test script that runs nothing is reported as "no tests", never as a pass. Large or parallelizable runs are delegated to the replicants:qa agent. Trigger when the user runs /replicants:qa, or asks to "QA this", "verify the acceptance criteria", "run the tests and report", or "check that X works as specified".
---

# /replicants:qa — verify against criteria, with evidence

Verify the work in front of you the way an independent tester would: decide what "done" means,
test each part of it with the project's real tools, and report a verdict per criterion that
anyone can reproduce. You find and document failures; you do not fix them in this procedure.

## Project context — read before testing

- The **project root** is `git rev-parse --show-toplevel` from the current working directory, or
  that directory itself outside git. Run everything from there.
- Read `<project root>/CLAUDE.md` (and any `CLAUDE.md` in the directory under test). A test,
  lint or quality-gate command it states is authoritative; its prohibitions apply to every step.
- **Never invent** a command, path, port, service or credential the project does not declare.
  If something you need is absent, report it as absent.

## Step 1 — derive the criteria

Take the criteria from the first source that has them:

1. **The prompt** — explicit acceptance criteria, conditions of acceptance or expected behaviour.
2. **`CLAUDE.md`** — stated quality gates.
3. **The code's contracts** — when the prompt only says "test it": the test suite passing, plus
   the documented behaviour (docstrings, types, README, API schemas) of what changed.

Number them. Split compound criteria. Do not widen the scope beyond what was asked.

## Step 2 — identify the test runner

1. `CLAUDE.md` first.
2. Then the project's entry points: `package.json` `scripts.test` (run with the package manager
   the lockfile names), `pyproject.toml` / `pytest.ini` / `tox.ini` / `setup.cfg`, `Makefile` /
   `Justfile` / `Taskfile` targets, CI workflow steps.
3. Then configuration: pytest config or `tests/test_*.py` → `python -m pytest`; `vitest.config.*`
   → `vitest run`; `jest.config.*` → `jest`; `go.mod` → `go test ./...`; `Cargo.toml` →
   `cargo test`.
4. **Confirm it is real** — the runner is installed (`--version` works, or it is in
   `node_modules/.bin` or the project's virtualenv) and the script actually invokes it.

**A script that runs nothing is not a test suite.** `"test": "exit 0"`, an `echo`, a target with no
runner behind it, or a run that collects zero tests → the verdict is **NO_TESTS** ("this project
has no tests"), never PASS. A configured runner that is not installed → **BLOCKED**.

## Step 3 — decide who runs it

- **Small or sequential runs:** run them yourself, non-interactively (no watch mode).
- **Large runs that split into independent slices** (a big suite, many independent criteria):
  delegate to the **`replicants:qa`** agent with the `Agent` tool
  (`subagent_type: "replicants:qa"`). Pass it the numbered criteria, the absolute project root,
  the hard constraints from `CLAUDE.md` quoted verbatim, and the runner command you identified.
  It can fan out up to 5 `replicants:qa_worker` slices and returns one consolidated report; relay
  that report, checking that every criterion has evidence.

## Step 4 — test each criterion

Test every criterion actively: run the scoped tests, execute the command, `curl` a service only on
a host and port the project declares, read data with read-only queries. Never mark a criterion as
passing without testing it. Do not edit source, tests or config to make something pass, and keep
temporary artifacts outside the project.

## Step 5 — report

```
QA REPORT — <scope> — <date>
Overall: PASS | FAIL | PARTIAL | NO_TESTS | BLOCKED
Test runner: <runner + version> — found via <file:line>   (or "none — <reason>")
Command(s) run: <exact commands>
Result line: <runner summary, verbatim>

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | ...       | PASS    | <output line / file:line / response> |

FAILURES
### FAILED: <title>
Expected: <...>   Actual: <verbatim error or output>
Steps to replicate: <numbered>
```

Report failure text verbatim. If something could not be determined, say so rather than guessing.
