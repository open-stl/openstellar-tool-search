# Global Agent Rules Strategy & Systematic Analysis: `ciembor/agent-rules-books`

## 1. Executive Summary

This document provides the definitive architectural analysis of the 14-book rule system from [`ciembor/agent-rules-books`](https://github.com/ciembor/agent-rules-books), evaluates the three compression tiers (`full`, `mini`, `nano`), resolves cross-book philosophical contradictions, and establishes the **Unified Curated Nano-Core** integrated into global `~/.config/opencode/AGENTS.md`.

---

## 2. Line-by-Line Census & Quantitative Footprint

Across all 14 books in the repository:

| Book | Full Tier (Lines / Chars) | Mini Tier (Lines / Chars) | Nano Tier (Lines / Chars) | Core Subject Area |
| :--- | :--- | :--- | :--- | :--- |
| **A Philosophy of Software Design** (Ousterhout) | 370L / 13.5 KB | 46L / 5.7 KB | 35L / 2.2 KB | Module depth, information hiding, complexity control |
| **Clean Architecture** (Martin) | 515L / 17.7 KB | 49L / 5.4 KB | 36L / 2.2 KB | Inward dependencies, boundaries, ports & adapters |
| **Clean Code** (Martin) | 297L / 13.8 KB | 47L / 3.8 KB | 32L / 1.2 KB | Local readability, function smallness, naming |
| **Code Complete** (McConnell) | 354L / 12.4 KB | 56L / 6.7 KB | 41L / 2.5 KB | Defensive programming, construction, verification |
| **Designing Data-Intensive Applications** (Kleppmann) | 393L / 16.0 KB | 55L / 6.9 KB | 34L / 2.5 KB | State truth, consistency, schemas, replication |
| **Domain-Driven Design** (Evans) | 979L / 42.4 KB | 48L / 5.6 KB | 39L / 2.2 KB | Strategic design, Ubiquitous Language, Bounded Contexts |
| **Domain-Driven Design Distilled** (Vernon) | 317L / 11.3 KB | 56L / 6.4 KB | 41L / 2.5 KB | Lean DDD, Subdomains, Aggregates, low ceremony |
| **Implementing Domain-Driven Design** (Vernon) | 337L / 12.8 KB | 57L / 7.3 KB | 37L / 2.7 KB | Tactical DDD implementation, Repositories, Events |
| **Patterns of Enterprise App Architecture** (Fowler) | 404L / 15.4 KB | 54L / 8.0 KB | 35L / 2.8 KB | Transaction Script, Domain Model, Data Mapper |
| **Refactoring** (Fowler) | 433L / 17.8 KB | 49L / 5.1 KB | 37L / 1.9 KB | Small verified steps, behavior preservation |
| **Refactoring.Guru** (Shvets) | 765L / 62.5 KB | 64L / 6.2 KB | 41L / 2.5 KB | Smell diagnosis, catalog of transformations |
| **Release It!** (Nygard) | 382L / 13.5 KB | 48L / 6.3 KB | 38L / 2.2 KB | Stability patterns, circuit breakers, fail-safe boundaries |
| **The Pragmatic Programmer** (Hunt & Thomas) | 359L / 13.3 KB | 65L / 7.1 KB | 44L / 2.2 KB | Orthogonality, DRY/SPoT, tracer bullets, pragmatism |
| **Working Effectively with Legacy Code** (Feathers) | 371L / 13.8 KB | 50L / 5.7 KB | 35L / 1.7 KB | Seams, characterization tests, breaking dependencies |
| **TOTALS (14 Books)** | **6,076L / 270 KB (~69.2k tok)** | **744L / 84 KB (~21.7k tok)** | **527L / 31 KB (~8.0k tok)** | |

---

## 3. The Multi-Tier Dilemma: Why Direct Dumps Fail

1. **The Full Tier Dump (69k tokens)**: Consumes nearly the entire prompt budget of typical model windows on every turn. Triggers rapid context compaction and degrades reasoning capacity.
2. **The Mini Tier Dump (22k tokens)**: Consumes ~10–15% of context window per turn. Dilutes agent attention across 744 lines of rules, causing the agent to miss project-specific requirements.
3. **The Nano Tier Dump (8k tokens)**: While token-manageable, blindly concatenating 14 nano rulebooks injects **contradictory instructions**:
   - *Clean Code* demands micro-functions (<20 lines) and tiny single-responsibility classes.
   - *A Philosophy of Software Design* explicitly warns against micro-functions and shallow classes as "classitis" and accidental complexity.
   - *DDD* demands Rich Domain Models and Aggregate invariants.
   - *PoEAA* recommends Transaction Script and Active Record for simple operations.

---

## 4. The Authoritative Synthesis: Option D (Curated Nano-Core)

To achieve maximum effectiveness across all workspaces without token waste or prompt contradictions:

```
+---------------------------------------------------------------------------------------------------------+
|                                    HIERARCHY OF ENGINEERING INVARIANTS                                  |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|  1. DEEP MODULE DESIGN (Ousterhout / APoSD)                                                             |
|     - Deep interfaces: maximize value provided per unit of API surface.                                 |
|     - Ban shallow wrappers, pass-through layers, and speculative 1-line helper fragmentation.           |
|                                                                                                         |
|  2. DEPENDENCY INVERSION & CLEAN LAYERING (Martin / Clean Architecture)                                 |
|     - Source dependencies point strictly inward toward domain policy.                                   |
|     - Core business logic must never import frameworks, databases, HTTP transports, or CLI drivers.     |
|                                                                                                         |
|  3. STRICT BEHAVIOR-PRESERVING REFACTORING (Fowler / Refactoring)                                       |
|     - Never combine refactoring with behavioral changes (bug fixes / new features).                     |
|     - Refactor in small, verified increments gated by existing tests before and after.                 |
|                                                                                                         |
|  4. SINGLE POINT OF TRUTH & ORTHOGONALITY (Hunt & Thomas / Pragmatic Programmer)                         |
|     - Every piece of knowledge, configuration, and state must have a single authoritative home.        |
|     - Changes to one module must not cause cascading side effects in unrelated domains.                 |
|                                                                                                         |
|  5. STATE TRUTH & OPERATIONAL RESILIENCE (Kleppmann / DDIA & Nygard / Release It!)                      |
|     - Declare authoritative state source, durability, and failure boundaries explicitly.                |
|     - Bound all external waits, timeouts, retries, and resources to prevent cascading failure.         |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
```

---

## 5. Implementation Topology

- **Global Baseline (`~/.config/opencode/AGENTS.md`)**: The Curated Nano-Core (<100 lines, ~1.5k tokens), applied globally across all workspaces.
- **Repository Level (`<repo>/AGENTS.md`)**: Project-specific architecture maps, codemaps, and technology stack rules.
- **On-Demand Skills (`mini` / domain packs)**: Loaded dynamically when a specific engineering workflow is triggered (`/codebase-design`, `/domain-modeling`, `/tdd`, `/refactor`).
