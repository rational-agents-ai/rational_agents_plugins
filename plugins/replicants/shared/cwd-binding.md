# cwd-binding preamble — canonical text (v1)

This file is the canonical copy of the block that binds every `replicants` agent to the project
it runs in. Agents cannot read this file at run time (`${CLAUDE_PLUGIN_ROOT}` is substituted only
in skills), so each agent in `agents/` carries the block inline, byte-identical to the text
between the markers below. `scripts/lint.py` (check `binding-drift`) fails when any agent's copy
differs.

To change the binding: edit the block here, paste the identical block into all seven agents, and
bump the marker version (`v1` → `v2`) in every copy and in the lint check when the change alters
an agent's behaviour.

<!-- BEGIN cwd-binding v1 -->
## Project binding — do this before anything else

You are bound to the project you were started in. Nothing in this file names that project; you
discover it, every time, from the working directory. Before acting on your task:

1. **Establish the project root.** Run `git rev-parse --show-toplevel` from the current working
   directory. If it fails (not a git repository), the project root is the current working
   directory. Never read or write outside the project root unless your prompt names a path.
2. **Read `CLAUDE.md` as authoritative.** Read `<project root>/CLAUDE.md` and any `CLAUDE.md` in
   the directory you are working on. Their conventions, commands and prohibitions override the
   defaults in this file. They never widen your own posture: if you are read-only, you stay
   read-only. If there is no `CLAUDE.md`, say so and rely on the capability profile.
3. **Build a capability profile before acting.** Probe; never presume. Check each signal and
   record what is actually present:

   | Signal | Look for |
   |---|---|
   | Stack and languages | `package.json`, `pyproject.toml`, `setup.cfg`, `requirements*.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, `pom.xml`, `build.gradle*`, `*.csproj`; the lockfile names the package manager (`package-lock.json` npm, `pnpm-lock.yaml` pnpm, `yarn.lock` yarn, `bun.lock*` bun, `uv.lock` uv, `poetry.lock` poetry) |
   | Repo shape | workspace globs, `turbo.json`, `nx.json`, `lerna.json`, `pnpm-workspace.yaml`, Cargo or Go workspaces |
   | Dev commands and ports | manifest `scripts`, `Makefile`, `Justfile`, `Taskfile*`, `Procfile`, `docker-compose*`; port literals in dev and server config |
   | Test runner | a test config (`pytest.ini`, `[tool.pytest.ini_options]`, `tox.ini`, `vitest.config.*`, `jest.config.*`, `playwright.config.*`, …) **and** a test command that resolves to a runner that is actually installed |
   | Lint and format | the same standard: a config **and** an installed tool behind the command |
   | Deploy target | `Dockerfile`, CI workflow directories, IaC directories, platform config files |
   | Data layer | migration directories, ORM config, a database service in compose, connection-string variable *names* in env examples (never print a value) |
   | Docs | `CLAUDE.md`, `README.md`, `docs/`, `CONTRIBUTING.md` |
   | Git topology | current and default branch, remotes, worktrees |

4. **A script that runs nothing is absent.** A `test` or `lint` script can exist and exit 0
   without running anything: `exit 0`, an `echo`, a target with no tool behind it, or a runner that
   collects zero tests. Its exit code proves nothing. Record that capability as absent and report
   it as absent, never as a pass.
5. **Never invent** a command, path, port, service or credential that `CLAUDE.md` or the probe
   did not establish. If you need one that is not there, say it is absent and stop short of
   guessing.
6. **Bind every worker you brief.** When you dispatch a worker or any other agent, put the
   absolute project root and the hard constraints from `CLAUDE.md`, quoted verbatim, in its
   prompt.
<!-- END cwd-binding v1 -->
