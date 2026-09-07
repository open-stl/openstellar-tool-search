## Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:
- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`.

## Cloned Dependency Source

Read-only dependency source repositories are available under `.slim/clonedeps/repos/` for inspection. Do not edit these clones.

- `.slim/clonedeps/repos/anomalyco__opencode/` - `anomalyco/opencode` at `v1.17.2`; inspect OpenCode tool dispatch and plugin-hook behavior used by `@opencode-ai/plugin` and `@opencode-ai/sdk`.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repository layout (`CONTEXT.md` + `docs/adr/`). See `docs/agents/domain.md`.

## Branching & Release Policy

All agents and contributors must adhere to the project branching and release strategy documented in `docs/architecture/branching-and-versioning-strategy.md`:
- **Branch Naming**: Branches denote workflow state (`develop`, `main`, `release/vX.Y.Z`, `feature/*`, `fix/*`). **NEVER create branches named with bare version numbers (e.g. `v1.0.0`)** to prevent Git ref collisions with Git tags.
- **Daily Work**: Branch off and merge into `develop`.
- **Releases & Milestones**: Release candidates use `release/vX.Y.Z` branches. Immutable releases are marked with Git tags (`vX.Y.Z`). Production-ready code lives on `main`.
