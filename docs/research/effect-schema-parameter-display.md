# Effect Schema Parameter Display — What `tool_search` Should Show

**Status:** Research findings (no production code changed). Validation owner: orchestrator.
**Date:** 2026-08-11
**Scope:** What the `tool_search` / `tool_search_regex` result should display in the `parameters` slot, and the correct conversion contract from Effect Schema to the model-facing form. Every claim is traced to a first-party source: opencode v1.17.2 source, the pinned local `@modelcontextprotocol/sdk@1.30.0`, the MCP 2025-06-18 specification, and the local `effect@4.0.0-beta.74` package (the version bundled with `@opencode-ai/plugin@1.17.2`). This file follows the repo's research-note convention (`docs/research/` + metadata header, cf. `tool-search-policy-audit.md`).

---

## 1. TL;DR

- The current output — `{"ast":{"~effect/Schema":"~effect/Schema","_tag":"Declaration","typeParameters":[]}}` — is the **Effect Schema internal AST** leaking through `JSON.stringify`, not a schema at all.
- What should be displayed instead is a **JSON Schema (draft 2020-12) object** — the same form opencode itself computes and the MCP spec mandates for `inputSchema`.
- The correct conversion contract is exactly what opencode already uses in `packages/opencode/src/tool/json-schema.ts`: `Schema.toJsonSchemaDocument(schema, { additionalProperties: true })` with `$defs` inlined and the `$schema` set to `https://json-schema.org/draft/2020-12/schema`.
- The conversion boundary belongs where the raw Schema is stored — `src/plugin.ts` `tool.definition` handler / `src/session-runtime.ts` `deferTool` — not in the formatter `src/session-tool-registry.ts` (which receives both JSON-Schema and Effect objects today and cannot distinguish them).

---

## 2. Current behavior (repo evidence) — where the AST leak happens

**The raw AST string appears in the result text via `formatHit`:**

```ts
// src/session-tool-registry.ts:23-28
function formatHit(r: ToolMeta): string {
  const paramsInfo = r.parameters && typeof r.parameters === 'object' && Object.keys(r.parameters).length > 0
    ? `\n  parameters: ${JSON.stringify(r.parameters)}`
    : '';
  return `${r.id}: ${r.description}${paramsInfo}`;
}
```

- `processSearchResult` renders hits through `formatHit` (`src/session-tool-registry.ts:148`), which is returned as the `tool_search`/`tool_search_regex` tool output (`src/session-runtime.ts:226-227`).
- `ToolMeta.parameters` is typed `unknown` (`src/types.ts:6`) and is stored by reference, never cloned (`src/session-runtime.ts:101-102` comment; `src/vault.ts:28-29`; `src/tool-store.ts:44-54`).
- For **Effect-declared tools**, the stored object is the raw Schema instance (see §4), whose enumerable own properties include `ast`, `annotations`, `compiler`-related members, `_tag` etc. `JSON.stringify` then serializes the internal AST, e.g.:

```json
{"ast":{"~effect/Schema":"~effect/Schema","_tag":"Declaration","typeParameters":[]}}
```

- The `delivery-history` fingerprint has the same blind spot: `computeFingerprint` (`src/delivery-history.ts:42`) hashes `stableStringify(toolMeta.parameters)` — the unstable raw AST, so **fingerprints vary across Schema instances** for identical parameter shapes (see §7).
- `tool-store.extractParamTexts` (`src/tool-store.ts:4-19`) only understands JSON-Schema-shaped `properties` objects — Effect ASTs contribute no parameter text to the search index (minor, secondary effect).

The tests currently encode the buggy shape: `tests/tool-search-e2e.test.ts:163-166` asserts `\n  parameters: ` appears, `:190` expects `parameters: ${JSON.stringify(...)}` of plain objects, and `:258-260` asserts `parameters:` — none of these cover the Effect-Schema case, which is why the AST leak ships.

---

## 3. What the tool result is for — the model-facing contract

The repo's own injected policy defines the contract (`src/session-runtime.ts:164-169`):

> `[Tool Search Policy] Tools marked "[deferred]" are deferred: their full description is not in your context.`
> `... Search results are the authoritative source of the canonical ID and parameter schema.`

So the result text must give the model a **schema it can call against** — i.e. the parameter shape (JSON Schema), not an internal representation. That is also what the tool descriptions promise: *"Returns full tool IDs and parameter schemas"* (`src/session-runtime.ts:190, 231`).

---

## 4. What opencode actually passes to the `tool.definition` hook — the raw Schema

First-party opencode v1.17.2 (`packages/opencode/src/tool/registry.ts`):

```ts
const output = {
  description: tool.description,
  parameters: tool.parameters,   // raw Tool.Def.parameters — an Effect Schema
  jsonSchema: tool.jsonSchema,
}
yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
```

- The hook contract types it as `parameters: any` (`packages/plugin/src/index.ts:334`), i.e. opencode makes **no guarantee about the shape** a plugin receives.
- `Tool.Def.parameters` is `Schema.Decoder<unknown>` (`packages/opencode/src/tool/tool.ts:111-114`):

```ts
export interface Def<Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>, ...> {
  id: string
  description: string
  parameters: Parameters
  jsonSchema?: JSONSchema7
  execute(args: Schema.Schema.Type<Parameters>, ctx: Context): ...
}
```

So when a plugin developer writes `tool({ args: Schema.Struct({...}) })` (or `tool.schema.string()` etc.), `parameters` is a live Effect `Schema` instance, and the repo's `deferTool` stores that instance. **`JSON.stringify` on it produces the raw AST shown in the bug.**

## 5. The correct display form — JSON Schema, and where opencode converts it

### 5.1 What opencode itself ships to the model is always JSON Schema

`packages/opencode/src/tool/json-schema.ts` (v1.17.2), the canonical conversion:

```ts
export function fromSchema(schema: Schema.Top): JSONSchema7 {
  const cached = cache.get(schema)
  if (cached) return cached

  const document = Schema.toJsonSchemaDocument(schema, { additionalProperties: true })
  const result = normalize({
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,   // "https://json-schema.org/draft/2020-12/schema"
    ...document.schema,
    ...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {}),
  })
  const inlined = dropDefinitionsIfResolved(inlineLocalReferences(result))
  if (!isJsonSchema(inlined)) throw new Error("tool JSON Schema helper produced a non-schema value")
  cache.set(schema, inlined)
  return inlined
}
export function fromTool(tool: Tool.Def): JSONSchema7 {
  return tool.jsonSchema ?? fromSchema(tool.parameters as Schema.Top)
}
```

- Effect Schema's JSON Schema generation targets **draft 07 by default** (`JSONSchema.make`), but opencode **overrides the target to 2020-12** via `JsonSchema.META_SCHEMA_URI_DRAFT_2020_12` and normalizes output (`normalize`, `inlineLocalReferences`, `dropDefinitionsIfResolved`).
- The conversion is cached per-schema in a `WeakMap` — the same pattern this repo should reuse (§6).
- opencode then hands the JSON Schema to the AI SDK: in `packages/opencode/src/session/tools.ts` the tool registry is wrapped with `ToolJsonSchema.fromTool(item)` and `tool({ inputSchema: jsonSchema(schema), ... })` (AI SDK `jsonSchema` helper). The AI SDK's `jsonSchema()` accepts a JSON Schema object, not an Effect Schema.

**Implication for this repo:** opencode's own pipeline *never* sends the raw Effect Schema to the model — it always converts to JSON Schema first. The `tool_search` result should therefore display the same JSON Schema form, using the same conversion API, so what the model sees is consistent with what the model would have seen had the tool not been deferred.

### 5.2 MCP `inputSchema` is JSON Schema by spec and SDK

MCP 2025-06-18 specification, `docs/specification/2025-06-18/server/tools.mdx` (in the `modelcontextprotocol/modelcontextprotocol` repo):

> - `inputSchema`: JSON Schema defining expected parameters

with an example `inputSchema: { "type": "object", "properties": { "location": { "type": "string", "description": "..." } }, "required": ["location"] }`.

Pinned SDK `@modelcontextprotocol/sdk@1.30.0` (`node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:2381`):

```ts
export declare const ToolSchema: z.ZodObject<{
  description: z.ZodOptional<z.ZodString>;
  inputSchema: z.ZodObject<{
    type: z.ZodLiteral<"object">;
    properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodCustom<object, object>>>;
    required: z.ZodOptional<z.ZodArray<z.ZodString>>;
  }, z.core.$catchall<z.ZodUnknown>>;
  ...
```

MCP servers therefore already deliver `inputSchema` as JSON Schema; this repo's `src/mcp/mcp-tool-adapter.ts:52` maps `mcpTool.inputSchema ?? {}` straight into `parameters`, and `src/mcp/convert-mcp-tool.ts` converts JSON Schema → Zod (`jsonSchemaToZod`) for execution. So for MCP tools the stored parameters are already JSON Schema and must be passed through **unchanged** — only Effect-Schema-shaped inputs need conversion. (Current SDK `main` reorganized into `@modelcontextprotocol/core@2.0.0` with `packages/core/src/types.ts`; the repo pins the legacy `1.30.0` surface above, which is the operative contract for this codebase.)

### 5.3 Why the AST form can never be right

- It is a **closed, versioned internal representation** — Effect's AST is not stable across versions or even across Schema instances (fresh `Schema.Struct({...})` calls produce distinct objects). It is meaningless to a model, leaks internals, and is not a contract.
- The model is expected to **produce JSON arguments**; JSON Schema is the only form both the model and the MCP/AI-SDK ecosystem consume.
- It bloats context with `~effect/Schema` symbol plumbing, contradicting this repo's entire premise (context reduction; cf. `docs/research/context-reduction-benchmark.md`).

---

## 6. Recommended conversion boundary

**Convert at ingestion, not at formatting.** The raw Schema should become JSON Schema once, at the point where `tool.definition` delivers the parameters — before storage in the vault — not inside `formatHit` on every render:

1. **`src/plugin.ts` `'tool.definition'` handler → `runtime.deferTool(...)`** (`src/plugin.ts:88-91`, `src/session-runtime.ts:101-107`): normalize `output.parameters` before `vault.add`. This is the single choke point for all tools, and opencode's contract (`parameters: any`) means we must detect the shape here (see §7).
2. **Where**: a small deep module (e.g. `src/schema-normalize.ts`) owning:
   - detection of Effect-Schema-shaped objects (`ast` present / `Schema.Struct`-like members),
   - the conversion via `Schema.toJsonSchemaDocument` from the plugin's bundled `effect` (opencode's own `@effect/schema` path; note the repo does not currently depend on `effect` directly — it is a transitive dependency of `@opencode-ai/plugin@1.17.2` which bundles `effect@4.0.0-beta.74`), with the same `additionalProperties: true`, 2020-12 `$schema` override and `$defs`-inlining shape opencode uses,
   - a `WeakMap` cache keyed on the Schema instance (opencode does exactly this),
   - **pass-through** for objects that are already JSON Schema (MCP input schemas) and for non-object primitives (`null`, `undefined`, `{}`).
3. **`src/session-tool-registry.ts` `formatHit`**: then only ever sees JSON Schema; `JSON.stringify` of it is correct and stable. (Optional hardening: fall back to omitting `parameters` if serialization yields non-JSON-Schema content.)
4. **Benefits cascade**: `tool-store.extractParamTexts` starts extracting real parameter descriptions for the search index; `delivery-history.computeFingerprint` hashes a stable document instead of an unstable AST (dedup/re-auth behavior becomes correct across Schema instances); the `parameters` block in results shrinks from AST-noise to the schema.

**Versioning caution:** `Schema.toJsonSchemaDocument` (a.k.a. the `SchemaRepresentation` API, `@since 4.0.0` per `effect/dist/Schema.d.ts`) is the Effect v4 API opencode uses; `JSONSchema.make` is the documented user-facing API (effect.website/docs/schema/json-schema). Either satisfies the contract; `toJsonSchemaDocument` matches opencode's exact output shape, so prefer it, pinned to the plugin's bundled effect version.

---

## 7. Compatibility and failure cases

| Case | Behavior today | Correct behavior |
|---|---|---|
| **Effect-declared tools** (`tool({ args: Schema.Struct(...) })`, `tool.schema.string()`) | `formatHit` stringifies raw AST; model sees garbage; fingerprint unstable; index misses param text | Convert once via `Schema.toJsonSchemaDocument` → JSON Schema (2020-12, `additionalProperties: true`, `$defs` inlined); stringify the document |
| **MCP tools** (repo's own MCP wiring) | `parameters` is already JSON Schema (`mcp-tool-adapter.ts:52`); `formatHit` shows it correctly today | Must stay **pass-through** — conversion must be shape-detecting, not blanket |
| **Already-JSON tools** (plugin passes `{ type: 'object', properties: {...} }`) | correct | unchanged |
| **`{}` / `null` / `undefined` parameters** | `formatHit` omits the `parameters:` line (`Object.keys(...).length > 0` guard) | keep omission |
| **`jsonSchema?: JSONSchema7` field** (opencode `Tool.Def`) | ignored (hook output carries it; repo only reads `parameters`) | prefer `tool.jsonSchema` if present — it is already the model-facing form (`fromTool` does `tool.jsonSchema ?? fromSchema(...)`) |
| **Unsupported types in schema** (`BigInt`, non-JSON-representable) | stringify shows AST; no error | `Schema.toJsonSchemaDocument` throws `Missing annotation ... requires a "jsonSchema" annotation` (effect docs, "Customizing JSON Schema Generation") — **do not crash the search**: catch per-tool, fall back to omitting `parameters` or the raw safe subset |
| **Schema with `$ref`/`identifier` annotations** | AST leaks | `$defs` + `$ref` appear (effect docs "Identifier Annotations"); opencode inlines resolved refs — match that or keep `$defs` as-is |
| **Optional vs required keys** | n/a | `toJsonSchemaDocument` emits `required`; opencode's `normalize` strips `null`-members from `anyOf` for non-required properties — matches model expectations |
| **Different effect versions across opencode versions** | n/a | conversion must be done with the **same** effect instance opencode bundled (hoisting hazards; see §6) |
| **`tool.definition` output mutation** | repo relies on hook passing raw object by reference | conversion must not mutate the caller's `output.parameters` (clone into the vault) — opencode re-reads `output.parameters` after the hook (`registry.ts:299`) |

---

## 8. Concrete acceptance tests for this repo

All in `tests/` (vitest, following `tests/tool-search-e2e.test.ts` / `tests/session-tool-registry.test.ts` patterns).

1. **Effect-Schema input renders JSON Schema, not AST.** Feed a deferred tool whose `parameters` is a real Effect Schema (`Schema.Struct({ query: Schema.String, limit: Schema.Number })` — constructed with the effect instance the test env provides) through the `tool.definition` hook → `tool_search_regex({ pattern: "^<id>$" })`. Assert the result text contains `parameters: {` and **does not contain** `"~effect/Schema"`, `"_tag"`, or `"typeParameters"`. Assert `"type": "object"` and `"properties"` with `query`/`limit`.
2. **MCP JSON-Schema pass-through.** A tool registered with `parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] }` (the exact MCP example shape) is displayed byte-identical in `parameters: {...}` — the converter must not re-wrap or mutate it.
3. **Empty/absent parameters.** `parameters: {}` → no `parameters:` line (existing guard preserved); `parameters: null` → no crash.
4. **Unsupported type fallback.** A schema containing `Schema.BigIntFromSelf` (or equivalent non-JSON-representable) → tool_search does **not** throw; either the `parameters` line is omitted or a safe placeholder appears; other hits in the same result are unaffected.
5. **Stability.** The same Effect Schema instance converted twice yields the same `parameters` JSON; `computeFingerprint` output is **identical for two distinct Schema instances describing the same shape** (this is currently false — it hashed the AST).
6. **`jsonSchema` field preference.** When the hook output carries `jsonSchema` (opencode's `Tool.Def.jsonSchema`), that value is what's displayed.
7. **Index integration.** After conversion, a parameter description from an Effect-declared tool's schema (`describe('...')` annotations) is findable via `tool_search` keyword match (validates `tool-store.extractParamTexts` now sees real text).
8. **Model-facing shape contract.** The rendered `parameters` value, parsed as JSON, satisfies: `type === 'object'`, optional `properties`/`required`, and (when non-empty) `$schema === 'https://json-schema.org/draft/2020-12/schema'` — mirroring opencode's `tool/json-schema.ts` output.
9. **No-crash on formatter.** `formatHit` never throws for any of the above inputs (property-access safety on arbitrary objects).

---

## 9. Primary sources

- opencode v1.17.2 `packages/opencode/src/tool/registry.ts` (hook trigger, `output.parameters = tool.parameters`): https://github.com/anomalyco/opencode/blob/v1.17.2/packages/opencode/src/tool/registry.ts
- opencode v1.17.2 `packages/opencode/src/tool/tool.ts` (`Def.parameters: Schema.Decoder`, `jsonSchema?: JSONSchema7`): https://github.com/anomalyco/opencode/blob/v1.17.2/packages/opencode/src/tool/tool.ts
- opencode v1.17.2 `packages/opencode/src/tool/json-schema.ts` (`fromSchema`/`fromTool`, 2020-12, `$defs` inlining): https://github.com/anomalyco/opencode/blob/v1.17.2/packages/opencode/src/tool/json-schema.ts
- opencode v1.17.2 `packages/opencode/src/session/tools.ts` (AI SDK `tool({ inputSchema: jsonSchema(schema) })`): https://github.com/anomalyco/opencode/blob/v1.17.2/packages/opencode/src/session/tools.ts
- opencode v1.17.2 `packages/plugin/src/index.ts` (`"tool.definition"?: (input: { toolID }, output: { description: string; parameters: any })`): https://github.com/anomalyco/opencode/blob/v1.17.2/packages/plugin/src/index.ts
- MCP 2025-06-18 spec, `docs/specification/2025-06-18/server/tools.mdx` ("`inputSchema`: JSON Schema defining expected parameters"): https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/server/tools.mdx
- MCP TS SDK pinned `@modelcontextprotocol/sdk@1.30.0`, `dist/esm/types.d.ts` `ToolSchema` (`inputSchema` = `{ type: "object", properties?, required? }`): local `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:2381-2392`
- Effect Schema JSON Schema docs (`JSONSchema.make`, draft targets, `$defs`, missing-annotation error): https://effect.website/docs/schema/json-schema
- Effect `4.0.0-beta.74` `dist/Schema.d.ts` (`toJsonSchemaDocument`, `SchemaRepresentation`, `@since 4.0.0`): local `node_modules/effect/dist/Schema.d.ts:6748, 8466-8480`
- Repo sources: `src/plugin.ts:88-91`, `src/session-runtime.ts:101-107, 185-232`, `src/session-tool-registry.ts:23-28, 116-150`, `src/types.ts:6`, `src/tool-store.ts:4-19`, `src/delivery-history.ts:42`, `src/mcp/mcp-tool-adapter.ts:52`, `src/mcp/convert-mcp-tool.ts`, tests `tests/tool-search-e2e.test.ts:163-166, 190, 258-260`
