# Rational Agents plugins for Claude Code

The **`rational-agents`** marketplace publishes two independent Claude Code plugins from
[Rational Agents](https://rational-agents.ai). Install either one on its own.

| Plugin | What it does |
|---|---|
| [**adr-consensus**](plugins/adr-consensus/README.md) | Drives an Architecture Decision Record to an implementation-readiness verdict (`READY`, `NEEDS_DECISION` or `NOT_READY`) through repeated independent review, scoped revision and consistency sweeps, using a quorum of Anthropic models you map per project. Also formats documents into the three-section ADR shape the review needs. |
| [**replicants**](plugins/replicants/README.md) | Generic engineering agents — implementer, analyst, QA, architect, deploy and their workers — and task skills for human-in-the-loop work. Each binds to the repository it runs in, so the same plugin works in any project. |

## Install

From the repository you want the plugins in:

```bash
claude plugin marketplace add rational-agents-ai/rational_agents_plugins --scope project
claude plugin install adr-consensus@rational-agents --scope project
claude plugin install replicants@rational-agents --scope project
```

Project scope records the plugins in that repository's `.claude/settings.json`, so everyone who
works in it gets the same setup. Use `--scope user` instead to enable them for yourself
everywhere.

Plugin skills are invoked by their namespaced names, for example `/adr-consensus:adr_consensus`
and `/replicants:qa`. See each plugin's README for its skills, agents and requirements.

## Updating and removing

```bash
claude plugin marketplace update rational-agents
claude plugin uninstall adr-consensus@rational-agents --scope project
```

## Versions

| Plugin | Version |
|---|---|
| adr-consensus | 0.1.0 |
| replicants | 0.1.0 |

## License

[MIT](LICENSE) © 2026 Rational Agents
