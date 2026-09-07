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

Follow `docs/architecture/branching-and-versioning-strategy.md`. Key rules:
- Branches denote workflow state (`develop`, `main`, `release/vX.Y.Z`, `feature/*`, `fix/*`) — never bare version numbers (`vX.Y.Z` collides with tags).
- Daily work branches off and merges into `develop`.
- Release candidates use `release/vX.Y.Z`; immutable milestones are Git tags; production code lives on `main`.

## Push & Release Hygiene

Two recurring failure modes — check before writing to remotes:

1. **Wrong authenticated account**: pushes and `gh` write operations must run under the account with write access to this repository. If a push fails with 403 `Permission denied to <account>`, switch to the account that owns the repo and retry.
2. **Version already published**: Before `npm publish` or `gh release create <tag>`, check whether the version/tag already exists remotely (`npm view <package> versions`, `gh release view <tag>`). On npm 409 or GitHub 422, another publisher won — verify the existing tarball contents (`npm pack <pkg>@<version>` + inspect) and fill an empty auto-created release via `gh release edit <tag> --notes-file ...`.
