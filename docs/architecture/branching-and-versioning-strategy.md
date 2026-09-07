# Branching & Versioning Strategy

This document defines the branching, tagging, and versioning standards for `@openstellar/tool-search`. Adherence to this strategy prevents Git reference ambiguities, isolates release candidates, and ensures predictable deployments.

---

## 1. Golden Rules

1. **Branches represent lifecycle and workflow status, NOT version releases.**
   - Allowed examples: `develop`, `main`, `release/v2.0.0`, `feature/semantic-ranker`, `fix/mcp-timeout`.
   - **CRITICAL**: NEVER use bare version numbers as branch names (e.g., do NOT create a branch named `v1.0.0` or `v2.0.0`). Doing so causes Git ref collisions between `refs/heads/v1.0.0` and `refs/tags/v1.0.0`, triggering push/fetch errors (`error: src refspec matches more than one`).
2. **Git Tags represent immutable release milestones.**
   - All release milestones are marked via Git annotated tags: `vX.Y.Z` (e.g., `v1.0.0`, `v1.1.0`) or pre-release tags `vX.Y.Z-beta.N` / `vX.Y.Z-rc.N`.
   - Tags are permanent, immutable pointers to specific commits.

---

## 2. Parallel Branch Topology

The repository follows a Gitflow-aligned parallel branch topology:

| Branch | Type | Purpose | Protected / Rules |
| :--- | :--- | :--- | :--- |
| `main` | Permanent | Stable, production-ready release code. Every commit on `main` reflects a published or ready-to-publish release. | Direct commits forbidden; merged via release PRs only. |
| `develop` | Permanent | Active development integration branch. Daily feature work and ongoing fixes land here. | Integration target for day-to-day work. |
| `release/vX.Y.Z` | Temporary | Hardening and pre-release candidate branch branched off `develop`. Used for beta verification, release stabilization, and final changelog adjustments. | Deleted after merging to `main` and `develop`. |
| `1.x` / `2.x` | Permanent (Optional) | LTS maintenance branches for backporting security fixes and critical patches to prior major versions when active development is on a newer major version. | Kept as needed for supported maintenance lines. |
| `feature/*` or `fix/*` | Temporary | Work-in-progress branches for specific tasks, bugfixes, or spikes. | Branched off `develop`; merged back into `develop`. |

---

## 3. Workflow Lifecycle (Step-by-Step)

```
develop ──────●──────●──────●──────●─────────────────●───────► (v2.1.0 dev)
               \                  /                 /
release/v2.0.0  \──────●─────────● (v2.0.0-beta.2) /
                        \                         /
main ────────────────────\───────────────────────● (v2.0.0 release)
```

### Step 1: Daily Development
- Agents and contributors branch off `develop` into task-focused branches:
  ```bash
  git checkout develop
  git pull origin develop
  git checkout -b feature/dynamic-rrf
  ```
- All unit and integration tests are verified.
- Completed work is merged back into `develop` via pull requests.

### Step 2: Beta & Hardening Cutover
- When features for a milestone (e.g., `v2.0.0`) are complete on `develop`, cut a dedicated release branch:
  ```bash
  git checkout develop
  git pull origin develop
  git checkout -b release/v2.0.0
  git push origin release/v2.0.0
  ```
- Package version in `package.json` is bumped to `2.0.0-beta.1`.
- A pre-release tag is created:
  ```bash
  git tag -a v2.0.0-beta.1 -m "Release v2.0.0-beta.1"
  git push origin v2.0.0-beta.1
  ```

### Step 3: Stabilization & Parallel Development
- Bug fixes, test stabilization, and smoke test adjustments for the release candidate are committed directly or merged into `release/vX.Y.Z`.
- Additional candidate releases are tagged as needed (`v2.0.0-beta.2`, `v2.0.0-rc.1`).
- **Parallel Work**: While `release/vX.Y.Z` is being stabilized, normal development of upcoming features continues on `develop` without interruption or feature freeze.

### Step 4: Official Release & Teardown
- Once the release candidate satisfies all validation checks:
  1. **Pre-flight check**: Confirm the version/tag does not already exist remotely — another publisher may have beaten you:
     ```bash
     npm view @openstellar/tool-search versions   # 409 if published
     gh release view v2.0.0                        # 422 if release exists
     ```
     If the tag exists with an empty auto-created release, fill it via `gh release edit v2.0.0 --notes-file notes.md` instead of recreating it.
  2. Bump version in `package.json` to `2.0.0`.
  3. Merge `release/v2.0.0` into `main`:
     ```bash
     git checkout main
     git pull origin main
     git merge --no-ff release/v2.0.0
     ```
  4. Create the official release Git tag on `main`:
     ```bash
     git tag -a v2.0.0 -m "Release v2.0.0"
     git push origin main
     git push origin refs/tags/v2.0.0
     ```
  5. Back-merge `release/v2.0.0` (or `main`) into `develop` to ensure any stabilization hotfixes are retained:
     ```bash
     git checkout develop
     git merge --no-ff release/v2.0.0
     git push origin develop
     ```
  6. Delete the temporary release branch:
     ```bash
     git branch -d release/v2.0.0
     git push origin --delete release/v2.0.0
     ```

---

## 4. Summary Quick Reference

- **Working on a new feature or fix?** -> Branch off `develop`.
- **Naming a branch?** -> Use prefixes like `feature/`, `fix/`, `release/vX.Y.Z`. **NEVER bare `vX.Y.Z`**.
- **Creating a milestone or release?** -> Use a Git Tag (`git tag -a vX.Y.Z`).
- **Target for release candidate?** -> `release/vX.Y.Z`.
- **Target for production release?** -> `main`.
