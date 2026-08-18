# The AI Coding Agent Rules & Engineering Book Distillations Ecosystem

**Status:** Comprehensive Research Report & Architectural Guide  
**Date:** 2026-08-17  
**Scope:** In-depth investigation and comparative analysis of software engineering rule sets, classic book distillations (`ciembor/agent-rules-books`, `booklib-ai/skills`, `mattpocock/skills`, `refactoring.guru-skill`), rule curation frameworks, progressive disclosure mechanisms, and dynamic MCP retrieval architectures for AI coding agents across OpenCode, Claude Code, Cursor, and Codex.

---

## Primary Sources & Inspected Repositories

1. **Classic Book Distillation Libraries**:
   - `ciembor/agent-rules-books` (Maciej Ciemborowicz) — [github.com/ciembor/agent-rules-books](https://github.com/ciembor/agent-rules-books) (Web: [ciembor.github.io/agent-rules-books](https://ciembor.github.io/agent-rules-books/))
   - `mattpocock/agent-rules-books` (Matt Pocock fork/mirror) — [github.com/mattpocock/agent-rules-books](https://github.com/mattpocock/agent-rules-books)
   - `ZLStas/skills` / `booklib-ai/skills` (Stanislav Zhuravlev) — [github.com/ZLStas/skills](https://github.com/ZLStas/skills)
   - `christianpasinrey/refactoring.guru-skill` (Christian Pasinrey) — [github.com/christianpasinrey/refactoring.guru-skill](https://github.com/christianpasinrey/refactoring.guru-skill)
   - `keez97/claude-architecture-skills` (Keez97) — [github.com/keez97/claude-architecture-skills](https://github.com/keez97/claude-architecture-skills)
   - `helmedeiros/clean-code-skills` (Helder Medeiros) — [github.com/helmedeiros/clean-code-skills](https://github.com/helmedeiros/clean-code-skills)
   - `PanGan21/clean-architecture-claude-skills` (PanGan21) — [github.com/PanGan21/clean-architecture-claude-skills](https://github.com/PanGan21/clean-architecture-claude-skills)
   - `yonatankarp/software-design-skills` (Yonatan Karp-Rudin) — [github.com/yonatankarp/software-design-skills](https://github.com/yonatankarp/software-design-skills)

2. **Agent Skills Standards, Process Frameworks & Engineering Rules**:
   - `mattpocock/skills` (Matt Pocock) — [github.com/mattpocock/skills](https://github.com/mattpocock/skills)
   - `d-padmanabhan/agent-engineering-handbook` (D. Padmanabhan, formerly `cursor-engineering-rules`) — [github.com/d-padmanabhan/agent-engineering-handbook](https://github.com/d-padmanabhan/agent-engineering-handbook)
   - `sammcj/agentic-coding` (Sam McLeod) — [github.com/sammcj/agentic-coding](https://github.com/sammcj/agentic-coding)
   - `khasky/human-readable-refactor` (Khasky) — [github.com/khasky/human-readable-refactor](https://github.com/khasky/human-readable-refactor)
   - `bienhoang/refactoring-kit` / `claude-skill-refactoring` (Bien Hoang) — [github.com/bienhoang/claude-skill-refactoring](https://github.com/bienhoang/claude-skill-refactoring)
   - `AMOSKILL45/refactor-architecture` (Amos) — [github.com/AMOSKILL45/refactor-architecture](https://github.com/AMOSKILL45/refactor-architecture)

3. **Open Standards & Distribution Registries**:
   - Agent Skills Open Specification — [agentskills.io](https://agentskills.io) / [github.com/agentskills/agentskills](https://github.com/agentskills/agentskills)
   - Vercel Labs Open Agent Skills CLI — [github.com/vercel-labs/skills](https://github.com/vercel-labs/skills) / [skills.sh](https://skills.sh)
   - Cursor Rules Directories & MDC Registries — [cursor.directory](https://cursor.directory), [github.com/PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules)

---

## 1. Executive Summary & Landscape Map

The emergence of autonomous AI coding agents (Claude Code, OpenCode, Cursor, OpenAI Codex CLI, Gemini CLI) created a fundamental engineering challenge: **How do we steer LLMs away from "vibe coding", hallucinated abstractions, bloated micro-functions, and silent architectural drift toward robust, battle-tested software engineering practices without blowing out context windows or causing instruction dilution?**

Two major schools of thought have coalesced to answer this:

```
+---------------------------------------------------------------------------------------------------------+
|                                    THE AGENT GUIDANCE SPECTRUM                                          |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|  [PARADIGM A: STATIC HEURISTIC RULESETS]              [PARADIGM B: DYNAMIC WORKFLOW SKILLS]             |
|  "What good code looks like"                          "How an engineer works step-by-step"              |
|                                                                                                         |
|  • ciembor/agent-rules-books (14 books)               • mattpocock/skills (grill, tdd, wayfinder)       |
|  • PatrickJS/awesome-cursorrules                      • keez97/claude-architecture-skills (4-phase)     |
|  • ZLStas/skills (booklib-ai)                         • bienhoang/refactoring-kit (5-phase pipeline)    |
|  • Static AGENTS.md / CLAUDE.md / .mdc                • AMOSKILL45/refactor-architecture (8-phase)      |
|                                                                                                         |
|  Mechanism:                                           Mechanism:                                        |
|  - Heuristic lists & constraints                      - Sequential state machines, gates, checkpoints   |
|  - Negative & positive rules (MUST / MUST NOT)        - Test-first feedback loops (Red-Green-Refactor)  |
|  - Tri-tier compression (full / mini / nano)          - Progressive disclosure (SKILL.md -> refs/)      |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
|                                   [HYBRID SYNTHESIS: THE MODERN STACK]                                  |
|                                                                                                         |
|  1. BASELINE LAYER: Tiny always-on project context (AGENTS.md / CLAUDE.md / nano rule, ~50-100 lines)  |
|  2. WORKFLOW SKILLS: User-invoked & model-invoked stateful processes (/tdd, /grill, /refactor)         |
|  3. HEURISTIC RULE PACKS: Domain/Task-disclosed book distillations (ciembor mini rules / GoF catalogs) |
|  4. DEEP RETRIEVAL LAYER: Graph MCP / BM25 search for external docs & architectural precedents (DDIA)   |
+---------------------------------------------------------------------------------------------------------+
```

### Key Findings:
1. **`ciembor/agent-rules-books` is the canonical heuristic standard for book distillations**, distilling 14 foundational software engineering texts into a disciplined three-tier format (`full`, `mini`, `nano`) and providing the only formal **Book Compatibility Matrix** in the industry.
2. **Book summaries are harmful; decision rubrics are effective.** Modern LLMs already possess extensive pre-trained knowledge of books like *Clean Code* or *Refactoring*. Feeding raw book text or chapter summaries induces prompt bloat and token waste. Effective rule sets function as **decision pressure**—specifying *when NOT to use a pattern*, *trade-off thresholds*, and *concrete rejection criteria*.
3. **The "Rules vs. Skills" Division of Responsibility:**
   - **Skills** govern *process* (phases, verification gates, safety checks, interactive interview loops).
   - **Rules** govern *heuristics* (layer boundaries, naming invariants, complexity budgets, code smell catalogs).
4. **Context Window Physics Mandate Progressive Disclosure:** An always-on 10,000-token rules file incurs a linear financial penalty on every LLM turn and causes **attention dilution** (the "lost-in-the-middle" effect). Best-practice implementations keep always-on files under 100 lines, relying on the **Agent Skills open standard (`agentskills.io`)** to dynamically disclose rich reference material on-demand.

---

## 2. Deep Dive: `ciembor/agent-rules-books`

Created by Polish software engineer Maciej Ciemborowicz (`ciembor`), `ciembor/agent-rules-books` addresses the gap between abstract software craftsmanship literature and machine-actionable agent prompts.

### 2.1 The 14 Distilled Books & Focus Areas

| # | Book Title | Author(s) | Category | Core Pressure / Primary Focus |
|---|---|---|---|---|
| 1 | **A Philosophy of Software Design (APoSD)** | John Ousterhout | Design & Complexity | Deep modules, small interfaces hiding large implementations, complexity reduction, comments explaining *why* |
| 2 | **Clean Architecture** | Robert C. Martin | Architecture | Inward Dependency Rule, Entities/Use Cases/Adapters separation, Stable Abstractions Principle |
| 3 | **Clean Code** | Robert C. Martin | Code Quality | Readability, meaningful names, small focused functions, single level of abstraction, self-documenting code |
| 4 | **Code Complete** | Steve McConnell | Construction | Defensive programming, variable scoping, routine construction heuristics, error processing |
| 5 | **Designing Data-Intensive Applications (DDIA)** | Martin Kleppmann | Distributed Systems | Reliability, replication lag, partitioning, strong vs. eventual consistency, failure modes |
| 6 | **Domain-Driven Design (Blue Book)** | Eric Evans | Domain Modeling | Ubiquitous language, bounded contexts, aggregates, entities vs. value objects, repositories |
| 7 | **Domain-Driven Design Distilled** | Vaughn Vernon | Strategic DDD | Rapid strategic bounded context mapping, subdomains (Core, Supporting, Generic), context maps |
| 8 | **Implementing Domain-Driven Design (Red Book)** | Vaughn Vernon | Tactical DDD | Aggregate invariant enforcement, domain events, ports & adapters, event-driven integration |
| 9 | **Patterns of Enterprise Application Architecture (PoEAA)** | Martin Fowler | Architecture & Data | Transaction Script vs. Domain Model, Unit of Work, Data Mapper, Repository, Identity Map |
| 10 | **Refactoring** | Martin Fowler & Kent Beck | Code Quality | Catalog of 66 refactoring techniques, 22 code smells, step-by-step behavior-preserving transformations |
| 11 | **Refactoring.Guru** | Alexander Shvets | Patterns & Refactoring | Expanded visual smell catalog, 23 GoF design patterns, trade-off matrix, anti-patterns |
| 12 | **Release It!** | Michael Nygard | Production Resilience | Circuit breakers, bulkheads, timeouts, steady-state enforcement, fail-fast mechanics |
| 13 | **The Pragmatic Programmer** | David Thomas & Andrew Hunt | General Engineering | DRY (Don't Repeat Yourself), Orthogonality, Tracer Bullets, Broken Windows theory, Domain Languages |
| 14 | **Working Effectively with Legacy Code (WELC)** | Michael Feathers | Legacy Modernization | Identifying seams, writing characterization tests, break-dependency algorithms, scratch refactoring |

### 2.2 The Three-Tier Compression Architecture

Following initial feedback regarding token consumption, `ciembor/agent-rules-books` v0.5 introduced a tripartite delivery model:

```
+-------------------------------------------------------------------------------------------------------+
|                                     THE 3-TIER COMPRESSION MODEL                                      |
+-------------------+--------------------+--------------------+-----------------------------------------+
| Tier              | Rule Count / Book  | Token Size / Book  | Primary Deployment Target               |
+-------------------+--------------------+--------------------+-----------------------------------------+
| 1. FULL           | 177 – 523 rules    | ~4,000 – 16,000 t  | Deep reference, audits, RAG/MCP corpus  |
| 2. MINI (Default) | 28 – 47 rules      | ~1,000 – 2,200 t   | On-demand Task Skills, Scoped Rules     |
| 3. NANO           | 14 – 26 rules      | ~300 – 700 t       | Always-on AGENTS.md / CLAUDE.md Base    |
+-------------------+--------------------+--------------------+-----------------------------------------+
```

#### Detailed Metrics by Book:

```
---------------------------------------------------------------------------------------------------------
Rule Set                                | Full Rules (Bytes)   | Mini Rules (Bytes)   | Nano Rules (Bytes)
----------------------------------------+----------------------+----------------------+------------------
A Philosophy of Software Design (APoSD) | 177 rules (13.5 KB)  | 28 rules (5.7 KB)    | 17 rules (2.2 KB)
Clean Architecture                      | 289 rules (17.7 KB)  | 31 rules (5.4 KB)    | 18 rules (2.2 KB)
Clean Code                              | 220 rules (13.8 KB)  | 29 rules (3.8 KB)    | 14 rules (1.2 KB)
Code Complete                           | 180 rules (12.4 KB)  | 38 rules (6.7 KB)    | 23 rules (2.5 KB)
Designing Data-Intensive Apps (DDIA)    | 205 rules (16.0 KB)  | 37 rules (6.9 KB)    | 16 rules (2.5 KB)
Domain-Driven Design (Evans)            | 523 rules (42.4 KB)  | 30 rules (5.6 KB)    | 21 rules (2.2 KB)
DDD Distilled (Vernon)                  | 158 rules (11.3 KB)  | 38 rules (6.4 KB)    | 23 rules (2.5 KB)
Implementing DDD (Vernon)               | 177 rules (12.8 KB)  | 39 rules (7.3 KB)    | 19 rules (2.7 KB)
Patterns of Enterprise App Arch (PoEAA) | 196 rules (15.5 KB)  | 36 rules (8.0 KB)    | 17 rules (2.8 KB)
Refactoring (Fowler)                    | 242 rules (17.8 KB)  | 31 rules (5.1 KB)    | 19 rules (1.9 KB)
Refactoring.Guru                        | 478 rules (62.5 KB)  | 46 rules (6.2 KB)    | 23 rules (2.5 KB)
Release It!                             | 204 rules (13.5 KB)  | 30 rules (6.3 KB)    | 20 rules (2.2 KB)
The Pragmatic Programmer                | 179 rules (13.3 KB)  | 47 rules (7.1 KB)    | 26 rules (2.2 KB)
Working Effectively with Legacy Code    | 193 rules (13.8 KB)  | 32 rules (5.7 KB)    | 17 rules (1.7 KB)
---------------------------------------------------------------------------------------------------------
```

### 2.3 The Book Compatibility Matrix (`docs/COMPATIBILITY.md`)

A critical contribution of `ciembor/agent-rules-books` is recognizing that **loading all books simultaneously produces catastrophic prompt conflict**. Classic authors hold incompatible philosophies on abstraction, granularity, and persistence.

```
+------------------------------------------------------------------------------------------------------+
|                                   MAJOR ARCHITECTURAL CONFLICTS                                      |
+-----------------------------------+-----------------------------------+------------------------------+
| Pair / Axis                       | Status                            | Nature of Conflict           |
+-----------------------------------+-----------------------------------+------------------------------+
| APoSD vs. Clean Code              | 🔁 Contradictory Granularity       | Ousterhout argues for "deep  |
|                                   |                                   | modules" (large cohesive     |
|                                   |                                   | functions hiding complexity).|
|                                   |                                   | Clean Code demands tiny      |
|                                   |                                   | 4-line functions and high    |
|                                   |                                   | class fragmentation.         |
+-----------------------------------+-----------------------------------+------------------------------+
| DDD vs. PoEAA                     | ❌ Mutually Exclusive             | DDD requires rich domain     |
|                                   |                                   | models, explicit aggregates, |
|                                   |                                   | and transaction boundaries.  |
|                                   |                                   | PoEAA active-record and      |
|                                   |                                   | transaction scripts leak     |
|                                   |                                   | persistence into domain.     |
+-----------------------------------+-----------------------------------+------------------------------+
| Clean Architecture vs. IDDD       | 🔁 Partially Redundant / Confusing | Clean Arch uses 4 concentric |
|                                   |                                   | rings; IDDD uses Hexagonal   |
|                                   |                                   | (Ports & Adapters). Similar  |
|                                   |                                   | intent, conflicting terms.   |
+-----------------------------------+-----------------------------------+------------------------------+
```

The matrix formally categorizes pairings as:
- ✅ **Compatible**: Synergistic principles (e.g., *Refactoring* + *WELC*; *Clean Architecture* + *The Pragmatic Programmer*).
- 🔁 **Conflicting / Redundant**: Requires choosing a primary authority or scoping by domain (e.g., *APoSD* vs. *Clean Code*).
- ❌ **Incompatible**: Opposing paradigms that must never be active in the same context (e.g., *DDD* vs. *PoEAA* Transaction Script).

---

## 3. The Broader Ecosystem & Alternatives

Beyond `ciembor/agent-rules-books`, multiple complementary and competing projects populate the agent engineering landscape:

```
+--------------------------------------------------------------------------------------------------------------------+
|                                    ECOSYSTEM TAXONOMY & PROJECT COMPARISON                                         |
+-----------------------------+-------------------------+----------------------+--------------------+----------------+
| Project / Repository        | Primary Focus           | Format / Standard    | Strengths          | Weaknesses     |
+-----------------------------+-------------------------+----------------------+--------------------+----------------+
| ciembor/agent-rules-books   | 14 Classic Books        | Markdown Rule Packs  | 3-tier compression,| Passive text;  |
|                             | (Heuristic Rules)       | (Codex/Claude/Cursor)| Compatibility      | no active test |
|                             |                         |                      | Matrix             | harness.       |
+-----------------------------+-------------------------+----------------------+--------------------+----------------+
| ZLStas/skills               | 22 Book Skills,         | Claude Code Plugins  | Multi-language     | Heavy weight;  |
| (booklib-ai/skills)         | 8 Reviewer Agents,      | & Slash Commands     | focus (Java, Rust, | Claude Code    |
|                             | 6 Rules (CLI: npx)      |                      | Python, TS)        | specific.      |
+-----------------------------+-------------------------+----------------------+--------------------+----------------+
| mattpocock/skills           | Engineering Disciplines | SKILL.md Standard    | Rigorous workflows,| Focused on     |
|                             | (TDD, Grilling, PRDs,   | (skills.sh / Claude) | Leading words,     | process rather |
|                             | Architecture, Wayfinder)|                      | Zero-token user-inv| than book rules|
+-----------------------------+-------------------------+----------------------+--------------------+----------------+
| christianpasinrey/          | 8 Pattern Catalogs,     | Standalone SKILL.md  | Routing by "force/ | Refactoring &  |
| refactoring.guru-skill      | 66 Refactorings,        | + 13 On-Demand Refs  | smell", not index; | GoF patterns   |
|                             | 22 Code Smells          |                      | Zero-dependency    | only.          |
+-----------------------------+-------------------------+----------------------+--------------------+----------------+
| keez97/                     | 7 Architecture Skills,  | Multi-phase Skills + | A/B eval suite,    | Cloud/Web      |
| claude-architecture-skills  | 4-Phase Pipeline        | Safety Checkpoints   | File-split safety  | architecture   |
|                             |                         |                      | protocols          | focus only.    |
+-----------------------------+-------------------------+----------------------+--------------------+----------------+
| d-padmanabhan/              | Enterprise Multi-Stack  | .mdc Rules, Skills,  | 15+ tech stacks,   | Huge surface;  |
| agent-engineering-handbook  | Handbook (15+ stacks)   | Custom MCP, Hooks    | Built-in eval suite| risk of prompt |
|                             |                         |                      | & custom MCP server| sprawl.        |
+-----------------------------+-------------------------+----------------------+--------------------+----------------+
| PatrickJS/                  | Crowd-sourced IDE Rules | .cursorrules / .mdc  | Massive coverage of| Low cohesion;  |
| awesome-cursorrules         | (Next.js, FastAPI, etc.)| files                | frameworks and libs| many uncurated |
|                             |                         |                      |                    | duplicates.    |
+-----------------------------+-------------------------+----------------------+--------------------+----------------+
```

### 3.1 `ZLStas/skills` (`booklib-ai/skills`)
- **Architecture**: A modular package providing 22 book-grounded skills, 8 autonomous reviewer agents, 6 always-on rules, and 22 slash commands.
- **Language-Specific Specialization**: Extends beyond general architecture into language idioms: *Effective Java*, *Effective Python*, *Effective TypeScript*, *Effective Kotlin*, *Rust in Action*, and *Spring Boot in Action*.
- **CLI & Packaging**: Packaged as `npx @booklib/skills add --profile=[ts|python|rust|architecture|core]`.
- **Autonomous Reviewers**: Includes multi-skill composite subagents like `@architecture-reviewer` (combining DDD + microservices + DDIA) and `@python-reviewer`.

### 3.2 `mattpocock/skills` (The "Real Engineering" Standard)
- **Philosophy**: Emphasizes *process predictability* over output generation. Skills are explicitly designed to combat "vibe coding" through disciplined feedback loops.
- **Progressive Disclosure Ladder**:
  1. **In-Skill Steps**: Primary sequential actions ending on checkable completion criteria.
  2. **In-Skill Reference**: Immediate flat definitions needed during execution.
  3. **Disclosed Reference**: Secondary subfiles (`GLOSSARY.md`, `references/`) loaded only when a branch is reached.
  4. **External Reference**: Reusable files across the project (`docs/agents/`, `CONTEXT.md`).
- **Invocation Dichotomy**:
  - **User-Invoked Skills** (`disable-model-invocation: true`): 0-token persistent context load. Invoked manually (e.g., `/grill-me`, `/to-spec`, `/implement`).
  - **Model-Invoked Skills**: Context description remains permanently resident to enable autonomous triggering (e.g., `/tdd`, `/domain-modeling`, `/diagnosing-bugs`, `/codebase-design`).
- **Leading Words**: Anchors behavior to strong model priors (e.g., *tracer bullets*, *fog of war*, *seam*, *characterization test*) to evoke rich behaviors in minimal tokens.

### 3.3 `christianpasinrey/refactoring.guru-skill`
- **Core Insight**: **"Routing by force, not by pattern index."** Models already know the implementation of a *Decorator* or *Factory Method*; their failure mode is *applying patterns where they are unwarranted*.
- **Mechanism**: Forces the agent to state the *force* (or *code smell*), the *chosen pattern*, and the *rejected alternative* before writing code.
- **Architecture**: A lean 5KB `SKILL.md` router backed by 13 on-demand reference catalogs that load only when a specific category is activated.

### 3.4 `keez97/claude-architecture-skills`
- **Safety First**: Solves the most hazardous failure mode of coding agents—**uncontrolled structural refactoring** (breaking imports and cyclic dependencies during file splitting).
- **Safety Protocols**: Mandatory compilation gates after every file extraction, atomic Git checkpoints, and explicit file-split protocols.
- **Empirical Evaluation**: Benchmark deltas demonstrated on assertion-graded test suites (+48.5% on architecture workflow, +65% on cloud infrastructure).

---

## 4. Deep Comparative Analysis: Three Architectural Dimensions

```
+-------------------------------------------------------------------------------------------------------+
|                                    THE THREE ARCHITECTURAL DIMENSIONS                                 |
+-------------------------------------------------------------------------------------------------------+
|                                                                                                       |
|  DIMENSION 1: COMPRESSION DEPTH       DIMENSION 2: DISCLOSURE STRATEGY     DIMENSION 3: STATE & SOURCING|
|                                                                                                       |
|  • Full (Reference / Audit)           • Always-On (AGENTS.md)              • Static Markdown Files    |
|  • Mini (Task / Focused Skill)        • Model-Invoked (Autonomous)         • Dynamic MCP Tools        |
|  • Nano (Baseline Constraint)         • User-Invoked (Explicit / 0-cost)   • Knowledge Graphs (Neo4j) |
|                                                                                                       |
+-------------------------------------------------------------------------------------------------------+
```

### 4.1 Dimension 1: Full-Length vs. Mini vs. Nano Distillations

```
+-------------------+--------------------+-----------------------+--------------------------------------+
| Compression Level | Context Footprint  | Attention Rentention  | Failure Mode / Risk                  |
+-------------------+--------------------+-----------------------+--------------------------------------+
| Full (Original)   | 10k – 40k tokens   | Low (Dilution / Drift)| Prompt saturation; agent ignores     |
|                   |                    |                       | project-specific files.              |
+-------------------+--------------------+-----------------------+--------------------------------------+
| Mini (Recommended)| 1k – 2.5k tokens   | High (Sharp Focus)    | Requires explicit task matching.     |
+-------------------+--------------------+-----------------------+--------------------------------------+
| Nano (Baseline)   | 200 – 600 tokens   | Very High (Anchor)    | Omits nuance; risks over-simplifying |
|                   |                    |                       | complex architectural trade-offs.    |
+-------------------+--------------------+-----------------------+--------------------------------------+
```

#### The Physics of Prompt Compression:
1. **The Negative Space Rule**: An effective rule set is defined by what it *forbids* and the *trade-offs* it makes explicit. Listing generic advice ("write clean, readable code") is a **no-op** that burns tokens without shifting model probability distributions.
2. **Modal Verb Rigor**: Effective distillations standardize on RFC 2119 keywords (**MUST**, **MUST NOT**, **SHOULD**, **RECOMMENDED**) paired with positive target behaviors.
3. **The Elephant Failure Mode**: Formulating rules as negative prohibitions ("Do not write large classes") activates the prohibited token concepts in attention layers. Distillations must state positive constraints ("Keep class responsibilities bounded to single domain concepts").

---

### 4.2 Dimension 2: Always-On Rules vs. On-Demand Skills (Progressive Disclosure)

```
+--------------------------------------------------------------------------------------------------------+
|                                  ALWAYS-ON VS. ON-DEMAND TOKEN ECONOMICS                               |
+------------------------------------+-----------------------------------+-------------------------------+
| Characteristic                     | Always-On (AGENTS.md / CLAUDE.md) | On-Demand (Agent Skills)      |
+------------------------------------+-----------------------------------+-------------------------------+
| Base Token Cost (per turn)         | Paid on turn 1..N (Cumulative)    | 0 tokens (or ~30t for desc)   |
| 50-turn Session Cost (5k rules)    | 250,000 input tokens wasted       | ~1,500 tokens total           |
| Cognitive Attention Window         | Crowded with irrelevant rules     | 100% focused on active task   |
| Scoping Granularity                | Global repository wide            | Scoped by task, path, command |
| Suitability for Multi-Book Curates | Terrible (conflicts + blowup)     | Excellent (modular injection) |
+------------------------------------+-----------------------------------+-------------------------------+
```

#### The Progressive Disclosure Model (`agentskills.io`):
1. **Tier 1 — Catalog Discovery**: At session init, only the `name` and `description` (with trigger branches) are loaded (~20-50 tokens per skill).
2. **Tier 2 — Execution Activation**: When the user prompt or task matches the trigger, the agent reads `SKILL.md` into context.
3. **Tier 3 — Deep Reference Fetching**: If and only if an edge case or specialized pattern is required, the agent reads linked documentation under `references/`.

---

### 4.3 Dimension 3: Static Rule Files vs. Dynamic Memory & MCP Retrieval

```
+-------------------------------------------------------------------------------------------------------+
|                                 STATIC VS. DYNAMIC KNOWLEDGE RETRIEVAL                                |
+-----------------------------------+-----------------------------------+-------------------------------+
| Attribute                         | Static Files (.md, .mdc)          | Dynamic MCP / Knowledge Graph |
+-----------------------------------+-----------------------------------+-------------------------------+
| Determinism & Reproducibility     | High (Versioned in Git)           | Moderate (Search ranking dep) |
| Latency & Tool Overhead           | Zero tool round-trips             | 1–3 tool round-trips required |
| Context Scalability               | Limited by context window         | Effectively infinite scale    |
| Codebase Relationship Awareness   | Static heuristics only            | Live AST / Call Graph / Traces|
| Best Use Case                     | Universal design principles,      | Codebase facts, call graphs,  |
|                                   | workflows, coding heuristics      | large API catalogs, ADRs      |
+-----------------------------------+-----------------------------------+-------------------------------+
```

#### Synergistic Architecture:
Static rules provide the **epistemic framework** (how to think and structure code), while MCP servers (such as `codebase-memory` or Context7) provide the **factual grounding** (how the specific system is connected).

---

## 5. Evaluation of `ciembor/agent-rules-books`

```
+------------------------------------------------------------------------------------------------------+
|                           EVALUATION SUMMARY: ciembor/agent-rules-books                              |
+-------------------------------------------------------------------+----------------------------------+
| Strengths                                                         | Trade-offs & Limitations         |
+-------------------------------------------------------------------+----------------------------------+
| • Most comprehensive canon in AI agent literature (14 books).     | • Purely declarative rules;      |
| • Industry-first three-tier compression (full / mini / nano).     |   lacks stateful workflows.      |
| • Formal Book Compatibility Matrix solving contradictory canons.   | • No built-in automated test/eval|
| • Highly portable (works on Codex, Claude Code, Cursor, OpenCode).|   harness for regression checks. |
| • Zero external dependencies; pure clean Markdown.               | • Risk of dogmatic application   |
|                                                                   |   if nano/mini rules misapplied. |
+-------------------------------------------------------------------+----------------------------------+
```

### 5.1 Is it the leading standard?
**Yes, for declarative software engineering book rules.** No other open-source repository matches its breadth, structured compression, and explicit compatibility mapping across classic texts.

However, **it is not a complete agent framework on its own**. It provides the *heuristics*, but lacks the *interactive workflows* of `mattpocock/skills` or the *validation pipelines* of `keez97/claude-architecture-skills`.

### 5.2 Ecosystem Integration: The Matt Pocock Discussion (Issue #133)
In `mattpocock/skills#133`, the intersection between these projects was formalized:
- **`skills` = How the agent works** (planning, red-green-refactor loops, interactive grilling, task slicing).
- **`agent-rules-books` = How the agent writes and designs code** (inward dependencies, information hiding, seam creation).

```markdown
# Recommended Composition Model:
/implement (Skill Process)
  └──> loads `clean-architecture.mini.md` (Design Heuristics)
/tdd (Skill Process)
  └──> loads `refactoring.mini.md` (Code Smell & Refactoring Rules)
/domain-modeling (Skill Process)
  └──> loads `domain-driven-design.mini.md` (Tactical Aggregate Rules)
```

---

## 6. Concrete Recommendations for OpenCode, Claude Code & Cursor

To achieve maximum code quality, deterministic behavior, and context efficiency, projects should adopt the **Unified Tri-Tier Architecture**:

```
+--------------------------------------------------------------------------------------------------------+
|                               THE UNIFIED AGENT INFRASTRUCTURE BLUEPRINT                               |
+--------------------------------------------------------------------------------------------------------+
|                                                                                                        |
|  [LAYER 1: ALWAYS-ON BASELINE] (Root AGENTS.md / CLAUDE.md)                                            |
|  • Project domain glossary pointer (CONTEXT.md)                                                        |
|  • Issue tracker & triage rules pointers                                                               |
|  • Exactly ONE nano rule set matching the core architecture (e.g. APoSD nano or Clean Code nano)       |
|  • Total Budget: < 80 lines (< 1,000 tokens)                                                           |
|                                                                                                        |
|  [LAYER 2: TASK-DRIVEN MODEL-INVOKED SKILLS] (.agents/skills/ or .claude/skills/)                      |
|  • /tdd -> Red-green-refactor feedback loop                                                            |
|  • /refactor -> Refactoring.Guru code smell router + Fowler transformations                             |
|  • /architecture -> Keez97 Clean Architecture review & safety checkpoints                              |
|  • /codebase-design -> Ousterhout deep module & seam design                                            |
|                                                                                                        |
|  [LAYER 3: USER-INVOKED GOVERNANCE & PLANNING] (disable-model-invocation: true)                        |
|  • /grill-me -> Socratic plan stress-testing                                                           |
|  • /to-spec -> Conversation-to-spec synthesizer                                                        |
|  • /wayfinder -> Multi-session decision map                                                            |
|                                                                                                        |
|  [LAYER 4: MCP KNOWLEDGE GRAPH & DEEP RETRIEVAL]                                                       |
|  • Full book reference files (DDIA, Evans DDD) indexed in MCP / FTS5                                   |
|  • Codebase knowledge graph (codebase-memory) for AST calls, callers, and blast radius                 |
|                                                                                                        |
+--------------------------------------------------------------------------------------------------------+
```

### 6.1 Tool-Specific Configuration Recipes

#### For OpenCode & Codex:
1. Place repository baseline in root `AGENTS.md`.
2. Install shared skills into `.agents/skills/` following the `agentskills.io` standard.
3. Import book rules as `mini` skill references inside `.agents/skills/<skill-name>/references/`.

#### For Claude Code:
1. Keep `CLAUDE.md` minimal; import `AGENTS.md` or keep local project pointers.
2. Install workflow skills into `.claude/skills/`.
3. Use `disable-model-invocation: true` for user-orchestrated commands (`/grill-me`, `/deploy`).
4. Place full book rules under `.claude/skills/<skill-name>/references/*.md` for progressive disclosure.

#### For Cursor:
1. Avoid bloated monolithic `.cursorrules` (legacy).
2. Use `.cursor/rules/*.mdc` with targeted `globs:` (e.g., domain models get `ddd.mini.mdc`, frontend components get `web-design.mdc`).
3. Set `alwaysApply: false` for all specialized book rules; set `alwaysApply: true` only for the single foundational project baseline.

---

## 7. Synthesis & Conclusion

The AI coding agent ecosystem has progressed rapidly from ad-hoc prompt engineering to a disciplined, layered software engineering specialty:

1. **`ciembor/agent-rules-books`** stands as the definitive, high-integrity distillation of foundational software engineering wisdom. Its 3-tier compression model and compatibility matrix should be the standard reference for declarative rules.
2. **`mattpocock/skills`** and **`agentskills.io`** provide the standard execution harness and process workflows needed to turn those rules into reliable, verifiable development cycles.
3. **Dynamic MCP integration** ensures that deep reference material and live codebase semantics can be queried on demand without polluting active context windows.

Adopting this combined architecture enables AI agents to produce disciplined, maintainable, production-ready software while maintaining minimal context overhead and zero prompt drift.

---
*Report compiled by Librarian — Research Specialist for Codebases and Documentation.*
