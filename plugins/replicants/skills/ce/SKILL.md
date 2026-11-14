---
name: ce
description: Apply Coding Excellence standards (SOLID, SRP, SoC, DRY, idempotency, orthogonality, Postel's Law, SOA, DDD, functional + OOP, dependency injection) when writing, editing, refactoring, reviewing, or proposing code in any language, within the current project's own conventions. Trigger when the user runs /replicants:ce, or on "write code", "implement", "refactor", "fix bug", "add feature", "code review", "propose architecture", "design a class/module/service", or any time code is being authored.
---

# /replicants:ce — Coding Excellence standards

For the remainder of this conversation, **all code you write, propose or review must comply with
these principles**, applied inside the conventions of the project you are working in.

## Project context — read before applying

- The **project root** is `git rev-parse --show-toplevel` from the current working directory, or
  that directory itself outside git.
- Read `<project root>/CLAUDE.md` (and any `CLAUDE.md` in the directory being changed). Its
  conventions — layout, naming, frameworks, prohibitions — take precedence over the defaults
  below; the principles govern how you write within them.
- Match the patterns already in the code you touch. Look before you add: find the existing
  helper, base class or layer before creating a new one.
- Verify with the project's **real** lint, type-check and test commands — from `CLAUDE.md` or the
  project's manifests — and never invent one. A script that runs nothing (`exit 0`, an `echo`,
  zero tests collected) is not a passing check.

## Standards in effect

| Principle | Requirement |
|-----------|-------------|
| **SOLID** | Single responsibility, open/closed, Liskov substitution, interface segregation, dependency inversion |
| **SRP** | Each module/class/function owns exactly one concern |
| **SoC** | Strict separation between layers (domain, infrastructure, application, interface) |
| **DRY** | No duplicated logic — extract shared types, helpers and services |
| **Idempotency** | Operations safe to repeat; deduplication at boundaries |
| **Orthogonality** | Changes in one module must not ripple into unrelated modules |
| **Postel's Law** | Be liberal in what you accept, strict in what you emit; return `None`/empty rather than raising for missing data |
| **SOA** | Prefer service-oriented boundaries; each service owns its domain |
| **DDD** | Model using entities, value objects, aggregates, domain services, repositories |
| **Functional** | Pure functions, immutability where practical, no side effects in domain logic |
| **OOP** | Encapsulation and isolation; favour composition over inheritance |
| **DI** | Constructor injection for all dependencies; no hidden globals or service locators |

## Layout rule (default when the project has none)

When the project has no established layout, organize directories by area of concern:

- `domain/` — entities, value objects, enums (zero external dependencies)
- `infrastructure/` — databases, external APIs, ORM
- `services/` — application and domain services
- `interfaces/` — CLI, HTTP and other entry points
- `config/` — settings, logging

Mirror this taxonomy under `tests/` so tests sit next to the layer they cover. When the project
already has a layout, follow it instead.

## Code review checklist

Before proposing any code change, verify:

- [ ] **Single responsibility** — does this module do exactly one thing?
- [ ] **No duplication** — is this logic already implemented elsewhere?
- [ ] **Dependencies injected**, not instantiated inline
- [ ] **Domain layer has zero infrastructure imports**
- [ ] **Idempotent** where touching shared state (database, filesystem, external API)
- [ ] **Postel's Law** — return `None`/empty for missing data; don't raise for legitimate empty results
- [ ] **New directories and files** follow the project's layout
- [ ] **Pure functions** in domain logic; side effects pushed to the edges
- [ ] **Composition over inheritance** unless modelling a true is-a relationship
- [ ] **Tests** sit at the layer of concern they cover; one assertion target per test

## References

- SOLID — https://en.wikipedia.org/wiki/SOLID
- Single Responsibility — https://en.wikipedia.org/wiki/Single-responsibility_principle
- Separation of Concerns — https://en.wikipedia.org/wiki/Separation_of_concerns
- DRY — https://en.wikipedia.org/wiki/Don%27t_repeat_yourself
- Idempotence — https://en.wikipedia.org/wiki/Idempotence
- Orthogonality — https://en.wikipedia.org/wiki/Orthogonality_(programming)
- Robustness Principle (Postel's Law) — https://en.wikipedia.org/wiki/Robustness_principle
- Service-Oriented Architecture — https://en.wikipedia.org/wiki/Service-oriented_architecture
- Domain-Driven Design — https://en.wikipedia.org/wiki/Domain-driven_design
- Functional Programming — https://en.wikipedia.org/wiki/Functional_programming
- Object-Oriented Programming — https://en.wikipedia.org/wiki/Object-oriented_programming
- Dependency Injection — https://en.wikipedia.org/wiki/Dependency_injection
