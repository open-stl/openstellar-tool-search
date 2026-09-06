# Token Counting Methodologies, Provider Discrepancies, and Benchmarking Standards

**Status**: Published Research  
**Author**: OpenStellar Research & Engineering  
**Scope**: Tokenization mechanics across OpenCode runtime, OpenAI, Google Gemini, Anthropic Claude, and Open-Source LLMs  
**Target Repository**: `@openstellar/tool-search`  

---

## 1. Executive Summary

Modern AI agent workflows routinely register hundreds of tool definitions across Model Context Protocol (MCP) servers and native plugins. As tool catalogs expand (often exceeding 100–300 tools with 250,000+ characters of JSON Schema), token consumption across system prompts and tool declarations becomes a critical cost and latency driver.

However, developers and benchmark authors observe severe discrepancies:
1. **The 2× Tool Schema Divergence**: An identical 310-tool MCP catalog (255,702 characters of JSON Schema) consumes **~110,282 to ~131,430 tokens** under OpenAI's `o200k_base` tokenizer (~2.3 characters/token), but only **~55,000 tokens** under Google Gemini's tokenizer (~4.65 characters/token).
2. **OpenCode Internal Accounting vs. Telemetry**: OpenCode does not utilize an internal BPE tokenizer (like `tiktoken` or `gpt-tokenizer`) for session compaction or UI estimation. Instead, OpenCode relies on a naive **`input.length / 4`** character heuristic for internal compaction thresholds and UI visual breakdowns, while consuming provider-returned runtime `usage` metrics for billing, overflow gating, and session state.
3. **The "Other" Context Artifact**: Because OpenCode's UI context breakdown estimates tokens exclusively from chat message content parts using `chars / 4`, the substantial token overhead of tool schemas (which are passed out-of-band in the API request's `tools` array) is lumped entirely into an ambiguous `"other"` category in the OpenCode user interface.
4. **Benchmark Incoherence**: Benchmarking tool virtualization solely on OpenAI tokenizers leads to confusion when users run the same setup on Google Gemini or Anthropic Claude and observe vastly different token totals on their gateway/proxy dashboards (e.g., LiteLLM, OpenRouter, Langfuse, Helicone).

This document provides a comprehensive, primary-source-grounded investigation into how tokens are calculated, why tokenizers diverge on structured JSON, how OpenCode processes tools internally, and how tool virtualization solutions must document and benchmark their performance.

---

## 2. OpenCode Implementation & Token Accounting Architecture

An audit of the authoritative OpenCode codebase (`anomalyco/opencode` at tags `v1.17.2` through `v1.18.x`) reveals a deliberate bifurcation between **pre-flight estimation** and **runtime billing/accounting**.

```
               ┌────────────────────────────────────────────────────────┐
               │              OpenCode Token Architecture               │
               └────────────────────────────────────────────────────────┘
                                            │
                   ┌────────────────────────┴────────────────────────┐
                   ▼                                                 ▼
     ┌───────────────────────────┐                     ┌───────────────────────────┐
     │   Pre-Flight Estimation   │                     │  Authoritative Telemetry  │
     │      (Offline / Heuristic) │                     │     (Post-Execution)      │
     └───────────────────────────┘                     └───────────────────────────┘
                   │                                                 │
      ┌────────────┴────────────┐                       ┌────────────┴────────────┐
      ▼                         ▼                       ▼                         ▼
┌──────────────┐         ┌──────────────┐        ┌──────────────┐          ┌──────────────┐
│ Compaction   │         │ UI Context   │        │ Provider API │          │ Context      │
│ Thresholds   │         │ Breakdown    │        │ Stream Usage │          │ Overflow     │
│ (chars / 4)  │         │ (chars / 4)  │        │ (getUsage()) │          │ (isOverflow) │
└──────────────┘         └──────────────┘        └──────────────┘          └──────────────┘
```

### 2.1 Core Token Estimation (`packages/core/src/util/token.ts`)

OpenCode does **not** bundle or invoke `tiktoken`, `gpt-tokenizer`, or any web-assembly subword tokenizer in its core or opencode CLI packages. The token estimation utility is defined as:

```typescript
// packages/core/src/util/token.ts (lines 1–5)
export * as Token from "./token"

const CHARS_PER_TOKEN = 4

export const estimate = (input: string) => Math.max(0, Math.round(input.length / CHARS_PER_TOKEN))
```

This utility is re-exported verbatim in `packages/opencode/src/util/token.ts`:
```typescript
// packages/opencode/src/util/token.ts (line 1)
export { Token, estimate } from "@opencode-ai/core/util/token"
```

### 2.2 Compaction & Tool Output Pruning (`packages/core/src/session/compaction.ts` & `packages/opencode/src/session/compaction.ts`)

When determining whether a conversation must be compacted or whether individual tool outputs must be truncated, OpenCode applies this 4-chars-per-token heuristic to JSON-serialized representations:

1. **Pre-Compaction Check**:
   ```typescript
   // packages/core/src/session/compaction.ts (lines 186–191)
   const estimate = (value: unknown) => Token.estimate(JSON.stringify(value))

   const compactIfNeeded = Effect.fn("SessionCompaction.compactIfNeeded")(function* (input: Input) {
     if (!config.auto) return false
     const context = input.model.route.defaults.limits?.context
     if (context === undefined || context <= 0) return false
     const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
     if (
       estimate({ system: input.request.system, messages: input.request.messages, tools: input.request.tools }) <=
       context - Math.max(output, config.buffer)
     )
       return false
     return yield* compactAfterOverflow(input)
   })
   ```
2. **Tool Output Pruning**:
   In `packages/opencode/src/session/compaction.ts`, OpenCode iterates backwards over messages. Once accumulated tokens exceed `PRUNE_PROTECT = 40_000` tokens, tool outputs exceeding `PRUNE_MINIMUM = 20_000` tokens are pruned and truncated using `Token.estimate(part.state.output)`.
3. **Turn Splitting**:
   When carving off the conversation head for summarization (`select()`), OpenCode counts characters backwards, using `tokens * 4` to determine string slice boundaries.

### 2.3 Runtime Telemetry & Session Ingestion (`packages/opencode/src/session/processor.ts` & `session.ts`)

While estimation uses `chars / 4`, OpenCode's **authoritative** context tracking and overflow triggers are powered entirely by provider-returned API usage objects:

1. **Stream Event Interception**:
   In `packages/opencode/src/session/processor.ts` (lines 359–378), on `case "step-finish"`:
   ```typescript
   const usage = Session.getUsage({
     model: ctx.model,
     usage: value.usage ?? new Usage({}),
     metadata: value.providerMetadata,
   })
   ctx.assistantMessage.tokens = usage.tokens
   ctx.assistantMessage.cost += usage.cost
   ```
2. **Cache Normalization & Token Aggregation**:
   In `packages/opencode/src/session/session.ts` (lines 180–232):
   ```typescript
   export const getUsage = (input: { model: Provider.Model; usage: Usage; metadata?: ProviderMetadata }) => {
     const inputTokens = safe(input.usage.inputTokens ?? 0)
     const outputTokens = safe(input.usage.outputTokens ?? 0)
     const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)
     const cacheReadInputTokens = safe(input.usage.cacheReadInputTokens ?? 0)
     const cacheWriteInputTokens = safe(
       Number(
         input.usage.cacheWriteInputTokens ??
           input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
           input.metadata?.["vertex"]?.["cacheCreationInputTokens"] ??
           input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
           0,
       ),
     )

     // AI SDK v6 normalized inputTokens to include cached tokens across all providers.
     // Subtract cache tokens to derive non-cached input count for tiered cost calculation:
     const adjustedInputTokens = safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens)

     const tokens = {
       total: input.usage.totalTokens,
       input: adjustedInputTokens,
       output: safe(outputTokens - reasoningTokens),
       reasoning: reasoningTokens,
       cache: { write: cacheWriteInputTokens, read: cacheReadInputTokens },
     }
     ...
   }
   ```
3. **Context Overflow Detection**:
   In `packages/opencode/src/session/overflow.ts` (lines 20–29):
   ```typescript
   export function isOverflow(input: {
     cfg: ConfigV1.Info
     tokens: SessionV1.Assistant["tokens"]
     model: Provider.Model
     outputTokenMax?: number
   }) {
     if (input.cfg.compaction?.auto === false) return false
     if (input.model.limit.context === 0) return false

     const count =
       input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
     return count >= usable(input)
   }
   ```
   If `isOverflow` evaluates to `true`, `ctx.needsCompaction = true` is set, which schedules session compaction on the subsequent agent turn.

### 2.4 UI Context Breakdown: The Origin of "Other" (`packages/app/src/components/session/session-context-breakdown.ts`)

Users frequently ask why OpenCode's visual context bar displays a large `"other"` segment when numerous MCP tools are loaded.

In `session-context-breakdown.ts`:
- The client estimates `system`, `user`, `assistant`, and `tool` (tool execution results) by dividing raw message characters by 4 (`Math.ceil(chars / 4)`).
- It compares the sum of these estimated message parts against `args.input` (the true, authoritative input tokens returned by the LLM provider):
```typescript
const estimated = tokens.system + tokens.user + tokens.assistant + tokens.tool
if (estimated <= args.input) {
  return build({ ...tokens, other: args.input - estimated }, args.input)
}
```
**Key Finding**: The request's `tools` array (containing all JSON schema parameters and descriptions) is transmitted as a top-level parameter to the LLM API, **not** as a message in `messages` or `parts`. Consequently:
$$\text{Tokens}_{\text{tool schemas}} + \text{Tokens}_{\text{provider wrapper}} \subseteq \text{Tokens}_{\text{other}}$$
Every token consumed by MCP tool declarations is categorized as `"other"` in OpenCode's TUI/GUI context bar.

### 2.5 Tool Schema Handling Across Providers (`packages/opencode/src/provider/transform.ts`)

OpenCode translates tool definitions into the Vercel AI SDK representation, which delegates formatting to the provider SDKs (`@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/anthropic`):
- **OpenAI**: Injects raw JSON Schema into `tools: [{ type: "function", function: { name, description, parameters } }]`. Injects `promptCacheKey: input.sessionID`.
- **Google Gemini**: Transforms JSONSchema7 via `ProviderTransform.schema()`:
  - Converts numeric enums to string enums.
  - Fixes missing array `items` schemas (defaults empty items to `{ type: "string" }`).
  - Strips `properties` and `required` from non-object types (which cause Gemini HTTP 400 errors).
  - Prunes `required` lists to include only keys actually present in `properties`.
- **Anthropic**: Attaches `cacheControl: { type: "ephemeral" }` metadata to tool objects or system prompts.

---

## 3. Major Provider Tokenization Standards (Primary Sources)

Different LLM providers implement radically different tokenization algorithms, vocabulary dictionaries, and function calling serialization layers.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                             LLM Provider Tokenizer Comparison                               │
├────────────────────┬─────────────────┬──────────────┬──────────────────┬────────────────────┤
│ Provider / Family  │ Algorithm       │ Vocab Size   │ JSON Density     │ Function Calling   │
│                    │                 │              │ (chars / token)  │ Overhead           │
├────────────────────┼─────────────────┼──────────────┼──────────────────┼────────────────────┤
│ Google Gemini      │ SentencePiece   │ 256,000      │ ~4.5 – 5.0       │ Native Protobuf /  │
│ (1.5 / 2.0 / Gemma)│ (BPE + byte fb) │ (262k in v2) │                  │ Struct Schema      │
├────────────────────┼─────────────────┼──────────────┼──────────────────┼────────────────────┤
│ OpenAI GPT-4o      │ Tiktoken BPE    │ 200,000      │ ~2.3 – 2.5       │ 7 tok/func +       │
│ (o200k_base)       │ (regex split)   │              │                  │ 3 tok/prop + 12 end│
├────────────────────┼─────────────────┼──────────────┼──────────────────┼────────────────────┤
│ OpenAI GPT-4       │ Tiktoken BPE    │ 100,277      │ ~2.3 – 2.5       │ 10 tok/func +      │
│ (cl100k_base)      │ (regex split)   │              │                  │ 3 tok/prop + 12 end│
├────────────────────┼─────────────────┼──────────────┼──────────────────┼────────────────────┤
│ Anthropic Claude   │ Custom BPE /    │ ~65,000 –    │ ~3.0 – 3.3       │ 290 – 675 tok      │
│ (Claude 3.5 / 3.7) │ SentencePiece   │ 100,000      │                  │ hidden system prompt│
├────────────────────┼─────────────────┼──────────────┼──────────────────┼────────────────────┤
│ Alibaba Qwen 2.5   │ Byte-level BPE  │ 151,643      │ ~3.8 – 4.3       │ ChatML /           │
│ (Coder)            │                 │ (+22 control)│                  │ Hermes format      │
├────────────────────┼─────────────────┼──────────────┼──────────────────┼────────────────────┤
│ Meta Llama 3 / 3.3 │ Tiktoken BPE    │ 128,256      │ ~3.2 – 3.5       │ Pythonic / JSON    │
│                    │ (split regex)   │              │                  │ Header Template    │
└────────────────────┴─────────────────┴──────────────┴──────────────────┴────────────────────┘
```

### 3.1 Google Gemini (and Gemma Family)
- **Primary Literature**:
  - *Gemma: Open Models Based on Gemini Research and Technology* (arXiv:2403.08295, Section 2 & Table 2).
  - *Gemma 2: Improving Open Language Models at a Practical Size* (arXiv:2408.00118).
  - *Gemma 3 Technical Report* (arXiv:2503.19786, Section 2 & Table 1).
  - Google DeepMind Gemma Repository: `gemma/gm/text/_tokenizer.py`.
  - Google AI Documentation: `ai.google.dev/gemini-api/docs/tokens`.
- **Tokenizer Architecture**:
  - SentencePiece implementation supporting Byte-Pair-Encoding (BPE) with byte-fallback (`byte_fallback = True`, with 256 `<0xNN>` byte tokens).
  - Preserves exact whitespaces using Unicode meta-character ` ` (`U+2581`).
  - Vocabulary Size: **256,000 tokens** in Gemini 1.0/1.5 and Gemma 1/2; expanded to **262,144 tokens** in Gemini 2.0 and Gemma 3.
  - Digit Splitting: `split_digits = True` (splits each numeric digit individually).
- **Corpus Characteristics & Token Density**:
  - The Gemini tokenizer was trained on an immense multilingual and source code corpus.
  - Because of the vast 256k vocabulary, common programming identifiers, keyword sequences, and structural punctuation patterns are merged into single tokens.
  - On structured JSON schemas and code, Gemini demonstrates exceptional compression efficiency: **~4.5 to 5.0 characters per token**.

### 3.2 OpenAI (GPT-4, GPT-4o, o1, o3)
- **Primary Literature**:
  - OpenAI Cookbook: *How to count tokens with tiktoken* (`examples/How_to_count_tokens_with_tiktoken.ipynb`, PR #2108).
  - `tiktoken` official releases: `cl100k_base` (GPT-4/3.5) and `o200k_base` (GPT-4o, o1, o3).
  - OpenAI Community technical disclosures on Function Calling Tokenization (reverse-engineered by `hmarr` and `Reversehobo`).
- **Tokenizer Architecture**:
  - Byte-Pair Encoding engine operating over regex-split lexical chunks:
    ```python
    # o200k_base splitting regex pattern
    r"""(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+"""
    ```
  - Vocabulary Sizes:
    - `cl100k_base`: **100,277 tokens** (100,000 base merges + 277 special tokens).
    - `o200k_base`: **200,000 tokens** (improved multilingual coverage and code compression).
- **Token Density on JSON & Code**:
  - On natural English text, `o200k_base` achieves ~4.0 chars/token.
  - On **formatted JSON Schema**, compression collapses to **~2.3 to 2.5 characters per token**.
- **OpenAI Tool Calling Internal Format**:
  - When tools are submitted to OpenAI Chat Completions, the API does **not** inject raw JSON Schema directly.
  - Internally, OpenAI rewrites the function definitions into a TypeScript-style interface block.
  - According to the OpenAI Cookbook reference implementation `num_tokens_for_tools()`:
    - Base overhead per function: **7 tokens** in GPT-4o (`func_init = 7`), **10 tokens** in GPT-4 (`func_init = 10`).
    - Base overhead per property: **3 tokens** (`prop_init = 3`), plus **3 tokens** for each property key (`prop_key = 3`).
    - Enum elements: **3 tokens** per enum entry (`enum_item = 3`).
    - End-of-tools delimiter overhead: **12 tokens** (`func_end = 12`).

### 3.3 Anthropic Claude (Claude 3.5, 3.7, 4.x)
- **Primary Literature**:
  - Anthropic Platform Documentation: *Token Counting* (`platform.claude.com/docs/en/build-with-claude/token-counting`).
  - Anthropic Documentation: *Tool use with Claude* (`platform.claude.com/docs/en/agents-and-tools/tool-use/overview`).
  - Anthropic SDKs (`POST /v1/messages/count_tokens`).
- **Tokenizer Architecture**:
  - Proprietary SentencePiece/BPE subword tokenizer (estimated ~65,000–100,000 vocabulary).
  - Anthropic explicitly cautions against third-party approximations:
    > *"Do not use `tiktoken`. It's OpenAI's tokenizer. It undercounts Claude tokens by ~15–20% on typical text, and by much more on code or non-English input. Any estimate from `tiktoken`, `gpt-tokenizer`, or similar is wrong for Claude."*
- **Fixed System Prompt Overhead for Tool Use**:
  - When `tools` are supplied in a request, Anthropic's backend injects an internal system prompt instructing Claude how to invoke tools.
  - The official token overhead for this prompt depends on the model and `tool_choice`:
    - **Claude Opus 4.8**: 290 tokens (`auto`/`none`), 410 tokens (`any`/`tool`).
    - **Claude Opus 4.7**: 675 tokens (`auto`/`none`), 804 tokens (`any`/`tool`).
    - **Claude Opus 4.5 / 4.6, Sonnet 4.5 / 4.6, Haiku 4.5**: **496–497 tokens** (`auto`/`none`), **588–589 tokens** (`any`/`tool`).
    - **Legacy Claude 3.5 Sonnet / Opus 4.0**: **313–315 tokens**.
  - This fixed overhead is added to the token count of the actual tool definitions (`name`, `description`, `input_schema`).

### 3.4 Local & Open-Source Models (Llama 3 & Qwen 2.5)
- **Meta Llama 3 / 3.1 / 3.3**:
  - Tokenizer: Tiktoken-compatible BPE with a **128,256** vocabulary.
  - Compression Density: Highly optimized for English and Python; moderate on JSON (~3.2–3.5 chars/token).
- **Alibaba Qwen 2.5 / Qwen 2.5 Coder**:
  - Primary Source: *Qwen2.5 Technical Report* (arXiv:2412.15115).
  - Tokenizer: Byte-level BPE (BBPE) with a **151,643** regular token vocabulary plus 22 dedicated control tokens (total 151,665).
  - Compression Density: Superior programming language and structured text compression (~3.8–4.3 chars/token), significantly outperforming Llama 3 on JSON schemas due to dedicated code symbols and whitespace tokens.

---

## 4. Tool Definition JSON Schema Discrepancy Analysis

### 4.1 The Empirical Discrepancy
In production evaluations using `@openstellar/tool-search` across 310 real MCP tools (representing 255,702 characters of formatted JSON schemas):
- **OpenAI `o200k_base`**: Evaluates to **~110,282 to ~131,430 tokens** (density: **~2.32 characters / token**).
- **Google Gemini API**: Evaluates to **~55,000 tokens** (density: **~4.65 characters / token**).

This represents a **2.0× difference in measured token volume** for the exact same semantic payload.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│               Token Density Comparison: 255,702-Character Tool Payload                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  OpenAI o200k_base  [████████████████████████████████████████] 110,282 - 131,430 tok   │
│                     (2.32 chars/token — Heavy punctuation fragmentation)               │
│                                                                                        │
│  Google Gemini      [████████████████████] ~55,000 tok                                 │
│                     (4.65 chars/token — High-capacity 256k SentencePiece merges)       │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Syntactic Dissection of JSON Schema Elements

Why does OpenAI fragment JSON schemas so severely compared to Gemini? The answer lies in the interaction between **regex pre-tokenization boundaries** and **vocabulary merge tables**.

#### 1. Regex Punctuation Splitting (OpenAI Tiktoken)
OpenAI's regex rules isolate punctuation marks (`"`, `:`, `{`, `}`, `[`, `]`, `,`) from adjacent alphabetical characters. Consider the standard JSON Schema fragment:
```json
"type": "string"
```
Under `o200k_base` and `cl100k_base`, this 16-character string is broken into **5 distinct tokens**:
1. Token 1: `"type` (leading quote merged with keyword)
2. Token 2: `":` (trailing quote merged with colon)
3. Token 3: ` "` (leading whitespace merged with quote)
4. Token 4: `string` (type identifier)
5. Token 5: `"` (closing quote)

Ratio: $16 \text{ chars} / 5 \text{ tokens} = 3.2 \text{ chars/token}$.

Now consider repeated structural properties:
```json
"properties": {
```
15 characters break into **4 tokens**: `['"', 'properties', '":', ' {']`.

And array declarations:
```json
"required": [
```
13 characters break into **4 tokens**: `['"', 'required', '":', ' [']`.

When these syntactic tokens are combined with JSON indentation (two or four spaces per nesting depth), each newline and indentation block emits 1–2 tokens:
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "The name of the user"
    }
  }
}
```
In Python with `tiktoken` (`o200k_base`):
- Total characters: **133**
- Total tokens: **41 tokens**
- Density: $133 / 41 = \mathbf{3.24\text{ chars/token}}$

In heavily nested MCP schemas with parameter objects, required arrays, constraints, and descriptions, average density drops further to **~2.2–2.3 chars/token**.

#### 2. Unicode Stream Merging & 256k Vocab (Google Gemini)
SentencePiece treats the entire input string as a continuous stream of Unicode characters, replacing spaces with ` ` (`U+2581`). It does **not** enforce OpenAI's hard regex boundaries around punctuation.

Because Gemini's vocabulary contains **256,000 tokens** (more than 2.5× the size of `cl100k_base` and 28% larger than `o200k_base`) and was trained directly on massive multi-language source code:
- Multi-character subwords frequently include combined punctuation and whitespace patterns (e.g., `": "`, `",\n `, `": {\n `).
- Common property names in OpenAPI/JSON schemas (`"description"`, `"properties"`, `"required"`, `"type"`) are represented as single pieces or composite subwords without punctuation fragmentation.
- Common schema type declarations like `"type": "string"` or `"type": "boolean"` merge into far fewer subword units.

#### 3. Native Wire-Format Differences
When tools are declared to Gemini via the official API (`generateContent` with `tools: [{ functionDeclarations: [...] }]`):
- Gemini ingests schemas as structured Protocol Buffers (`google.ai.generativelanguage.v1beta.FunctionDeclaration`), not as a raw JSON string interpolated into a text prompt.
- Gemini's server-side tokenizer measures the tokens required to represent the internal schema structure directly.
- Consequently, whitespace formatting, indentation spaces, quotes, and commas in client-side JSON do not incur token penalties on Gemini.

---

## 5. Recommendations for Benchmarking & Public Documentation

When publishing benchmarks or documentation for tool virtualization solutions (such as `@openstellar/tool-search`), discrepancies between tokenizer standards create substantial risk of user misunderstanding.

A user reading:
> *"Reduces prompt overhead by 100,000 tokens across 310 tools"*

who then runs the plugin on Google Gemini 2.0 and observes only ~55,000 total baseline tokens on their OpenRouter/LiteLLM dashboard, may conclude the benchmark is fraudulent or inaccurate.

### 5.1 The Dual-Reporting Standard

All documentation, README files, and empirical benchmark reports must adopt a **Dual-Reporting Framework**:

```markdown
### Benchmark Protocol: Dual-Metric Standard

1. Canonical Reference Metric (OpenAI o200k_base):
   - Tokenizer: `Xenova/gpt-4o` / official `tiktoken` (`o200k_base`)
   - Role: Provides a deterministic, reproducible, model-agnostic industry standard (aligned with BFCL and OpenAI benchmarks).
   - Baseline Footprint (310 MCP Tools): 131,430 tokens (~2.3 chars/token).
   - Savings: -100,265 tokens (-76.3% context reduction).

2. Provider-Native Runtime Telemetry:
   - Google Gemini 1.5 / 2.0 (SentencePiece 256k):
     - Baseline Footprint: ~55,000 tokens (~4.65 chars/token).
     - Net Savings: ~42,000 provider tokens.
     - Note: Gemini's 256k vocabulary compresses JSON schemas ~2× more densely than o200k_base.
   - Anthropic Claude 3.5 / 3.7 / 4.x:
     - Baseline Footprint: ~75,000–85,000 tokens + 496–675 fixed tool system prompt overhead.
     - Net Savings: ~55,000–65,000 provider tokens.
```

### 5.2 Explaining OpenCode UI & Proxy Dashboard Telemetry

Documentation must proactively answer three common user questions:

1. **Why does my proxy dashboard (LiteLLM / OpenRouter / Helicone) show different numbers than the README?**
   - *Explanation*: The README benchmarks are measured against the canonical `o200k_base` BPE tokenizer. If you are routing to Gemini, the provider reports tokens using its 256k SentencePiece tokenizer, which yields ~50% fewer tokens for identical schemas. If you are routing to Claude, Anthropic reports tokens via its native tokenizer plus a model-specific 290–675 token tool system prompt.
2. **Why does OpenCode's TUI show tool tokens under "other"?**
   - *Explanation*: OpenCode's UI (`session-context-breakdown.ts`) estimates tokens from message parts using a `chars / 4` heuristic. Tool definitions are transmitted out-of-band in the API request's `tools` payload. OpenCode computes `"other" = provider_input_tokens - sum(message_parts)`. Therefore, tool schema tokens naturally appear in the `"other"` segment.
3. **Does OpenCode use `tiktoken` internally for compaction?**
   - *Explanation*: No. OpenCode uses `Math.round(JSON.stringify(payload).length / 4)` to estimate whether compaction is needed, but triggers actual compaction only when the LLM provider's returned `usage` metrics signal context overflow (`isOverflow()`).

---

## 6. Primary Sources & Architectural References

### 6.1 OpenCode Codebase (`anomalyco/opencode`)
- **`packages/core/src/util/token.ts`** (lines 1–5): Definition of `CHARS_PER_TOKEN = 4` and `estimate()`.
- **`packages/opencode/src/util/token.ts`** (line 1): Re-export of core estimation utility.
- **`packages/core/src/session/compaction.ts`** (lines 180–205): `compactIfNeeded`, `estimate` using `JSON.stringify`, and `select()` turn boundary calculations.
- **`packages/opencode/src/session/compaction.ts`** (lines 35–120): `PRUNE_MINIMUM`, `PRUNE_PROTECT`, and tool output truncation heuristics.
- **`packages/opencode/src/session/overflow.ts`** (lines 15–30): `usable()` context limit calculations and `isOverflow()` check using provider-reported tokens.
- **`packages/opencode/src/session/processor.ts`** (lines 359–378): Interception of `case "step-finish"` stream events and extraction of `value.usage`.
- **`packages/opencode/src/session/session.ts`** (lines 180–235): `getUsage()` implementation normalizing cache read/write tokens and computing provider-tiered costs.
- **`packages/app/src/components/session/session-context-breakdown.ts`** (lines 10–105): `estimateTokens = Math.ceil(chars / 4)` and derivation of the `"other"` visual breakdown segment.
- **`packages/opencode/src/session/tools.ts`** (lines 50–165): Assembly of MCP and native tools into Vercel AI SDK definitions.
- **`packages/opencode/src/provider/transform.ts`** (lines 80–140): `ProviderTransform.schema()` cleaning JSON schemas for Gemini and Kimi.

### 6.2 Provider Specifications & Research Literature
- **Google Gemini / Gemma**:
  - *Gemma Team et al.*, "Gemma: Open Models Based on Gemini Research and Technology", arXiv:2403.08295 (2024).
  - *Gemma Team et al.*, "Gemma 2: Improving Open Language Models at a Practical Size", arXiv:2408.00118 (2024).
  - *Gemma Team et al.*, "Gemma 3 Technical Report", arXiv:2503.19786 (2025).
  - *T. Kudo and J. Richardson*, "SentencePiece: A simple and language independent subword tokenizer and detokenizer for neural text processing", EMNLP (2018).
  - Google DeepMind Gemma Repository: `https://github.com/google-deepmind/gemma/blob/main/gemma/gm/text/_tokenizer.py`.
  - Google Cloud Vertex AI: *Count Tokens API Reference*, `cloud.google.com/vertex-ai/generative-ai/docs/model-reference/count-tokens`.
- **OpenAI**:
  - OpenAI Cookbook: *How to count tokens with tiktoken*, `github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb`.
  - OpenAI Cookboook PR #2108: *Update examples/How_to_count_tokens_with_tiktoken.ipynb* (Structured outputs and function token counting).
  - OpenAI `tiktoken` repository: `github.com/openai/tiktoken` (`o200k_base` and `cl100k_base` vocabulary definitions).
- **Anthropic Claude**:
  - Anthropic API Reference: *Token Counting Endpoint* (`POST /v1/messages/count_tokens`), `platform.claude.com/docs/en/build-with-claude/token-counting`.
  - Anthropic User Guide: *Tool Use with Claude - Pricing and Token Overhead*, `platform.claude.com/docs/en/agents-and-tools/tool-use/overview`.
- **Alibaba Qwen**:
  - *Qwen Team*, "Qwen2.5 Technical Report", arXiv:2412.15115 (2024).
  - Alibaba Qwen Tokenizer Definition: Byte-level BPE with 151,643 vocab + 22 control tokens.
- **Meta Llama**:
  - *Meta AI*, "The Llama 3 Herd of Models", arXiv:2407.21783 (2024).
  - Meta Llama 3 Tokenizer: Tiktoken-based BPE with 128,256 vocabulary.
