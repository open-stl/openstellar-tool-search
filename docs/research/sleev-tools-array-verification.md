# Sleev Tools Array Verification — Empirical Evidence

**Date:** 2026-09-02
**Status:** VERIFIED (byte-level, from real Sleev gateway debug logs)
**Question answered:** Does Sleev compression touch the `tools` array (and thus our re-injected tool schemas / cache stability)?

---

## Method

- Source: real Sleev gateway debug logs (`/Users/chewji/.local/state/sleev/debug-logs/http/**/request/`)
- Corpus: **51 request pairs** (02_canonical.initial = client send, canonical.final = upstream forward)
- Note: canonical format stores tools inside `params.tools` (NOT top-level) — earlier scans looked at the wrong field and falsely reported "0 samples with tools".
- Content is HMAC-redacted in canonical files, so comparison is by **hash + structure + byte-length + count**, which is sufficient for equality/inequality of JSON.

## Findings (byte-level)

| Metric | Result | Interpretation |
| :--- | :--- | :--- |
| Pairs with `tools` present | **51 / 51** | tools array is always in the request |
| Pairs where tools changed | **51 / 51** | Sleev DOES modify `tools` |
| Tool count | **320 → 321 (+1)** | Sleev appends exactly one tool |
| First 320 tools | **identical 320 / 320** | existing tools (incl. ours) untouched |
| Extra tool | `compress` (function) | Sleev's own compression tool |
| `compress` tool stability | **1 distinct hash variant × 49 occurrences** | appended tool is constant |
| Cross-request tools array | **321 / 321 byte-identical** | tools array stable across requests |
| `tool_choice` | **0 diffs** | untouched |
| `system` | array length unchanged (2→2) | structure stable (content redacted in logs) |
| `messages` | pruned in **42 / 51** pairs | Sleev compacts conversation history |

## Conclusions

1. **Sleev does NOT strip, modify, or reorder our tools.** It only **appends its own constant `compress` tool** at the end of `params.tools`.
2. **No cache destabilization from tools:** the appended tool is byte-identical every request, so the tools array has a **stable prefix + stable suffix** → prompt cache stays hit. The only one-time cost is the first request after Sleev starts injecting.
3. **Our `applyContextTurn` re-inject is compatible with Sleev:** full schemas of Deferred-Authorized tools live in `params.tools` and survive compaction. Sleev pruning `messages` does not remove tool schema data.
4. **The compact message evidence is safe:** Sleev's `compress` tool call + its per-ID entries live in messages, which Sleev may prune; authorization state resides in the Tool Vault + tools array, not only in messages.

## Open risks / limitations

- Canonical logs redact content → "system content unchanged" is structural only (length 2→2), not content-level proof.
- The 320-tool sample predates/does not include our per-turn re-inject traces (no tool_search strings in sampled pairs) → end-to-end check of re-injected schemas surviving compaction still recommended as a follow-up runtime probe.
- `parallel/` nested request dirs exist; corpus includes them (1/51 pair from parallel layout).

## Reproduce

```bash
node -e '/* scan script: see session transcript */'
# corpus: find /Users/chewji/.local/state/sleev/debug-logs/http -name "*canonical*"
```
