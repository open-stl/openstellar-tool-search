# Complete Software Engineering Books & Rules Catalog

This catalog documents the comprehensive rules, architectural principles, antipatterns, and concrete heuristics from all 14 canonical software engineering books in .

---

## A Philosophy of Software Design

- **Author**: John Ousterhout
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (370 lines / 13 KB) | Mini (46 lines / 5 KB) | Nano (35 lines / 2 KB)

### Core Bias to Correct (Nano Essence)

# OBEY A Philosophy of Software Design by John Ousterhout

## When to use

Use when the main risk is accidental complexity, shallow abstractions, leaky interfaces, or tactical patches.

## Primary bias to correct

Working code, small pieces, and familiar wrappers are not automatically simple.

## Decision rules

- Optimize for lower cognitive load and local understandability, not shorter files, familiar patterns, fewer lines, or clever compactness.
- Prefer deep modules; reject wrappers, layers, helpers, facades, and split-outs that do not hide real complexity.
- Hide volatile decisions, representations, storage, protocol facts, workflow bookkeeping, and messy edge handling in one owning module.
- Make interfaces caller-centered and semantic; avoid staged APIs, flags, setup sequences, and mechanism leakage when the module can provide the right operation.
- If a change feels awkward or spreads widely, improve ownership and abstraction instead of adding tactical special cases.
- Combine or split by total complexity: keep shared knowledge together and split only at independently understandable boundaries.
- Treat names and comments as design signals: precise abstraction names, explicit contracts, and no comments that compensate for bad decomposition.
- Add complexity for performance, trends, patterns, frameworks, tests, or exception handling only when evidence or caller needs justify it.

## Trigger rules

- When adding a helper, layer, option, callback, pattern, or abstraction, prove it removes complexity for callers.
- When an API requires sequencing, representation, storage, transport, caching, protocol, or file-format knowledge, redesign the boundary.
- When naming is hard, comments get long, or reviewers are surprised, treat it as design evidence.
- When one change spreads widely, look for duplicated knowledge, hidden dependencies, temporal coupling, or the wrong owner.
- When optimizing or adding exception paths, keep the common path simple and require evidence or a stronger invariant.

## Final checklist

- Fewer concepts to hold?
- More complexity hidden below the right boundary?
- Fewer special cases, knobs, leaks, and call-order traps?
- Better names, contracts, ownership, and evidence for any added complexity?


### Mini Rules Specification

# OBEY A Philosophy of Software Design by John Ousterhout

## When to use

Use for module design, API changes, decomposition, refactoring, naming, comments, tests, performance work, and changes that feel awkward or spread complexity across files.

## Primary bias to correct

Working code, small pieces, familiar patterns, flags, wrappers, and extra documentation do not make a design simple when they increase cognitive load or leak knowledge.

## Decision rules

- Use reduced complexity as the primary success metric. Prefer the design that lowers cognitive load, change amplification, hidden dependencies, temporal coupling, and the number of facts a reader must hold at once.
- Treat design as continuous work. A first working patch is not done if it worsens future changeability; compare plausible alternatives for non-trivial interface, decomposition, or abstraction choices.
- Prefer deep modules: small, semantic interfaces that hide meaningful internal complexity. Reject pass-through services, thin library wrappers, helper modules, and tiny split-outs that add names without reducing reader burden.
- Design interfaces around what callers need to know, not how the implementation works. Avoid fragile staging, setup sequences, mode flags, configuration knobs, and arguments that expose internal choices.
- Hide volatile decisions, internal representations, storage shape, protocols, file formats, performance hacks, bookkeeping, normalization, and messy edge handling inside the module that owns the knowledge.
- Pull complexity downward when the lower module owns the detail. Prefer a slightly more complex implementation if it gives callers a simpler public contract and removes repeated reasoning from call sites.
- Choose generality at the right level. Avoid one-caller overfitting, vague speculative abstractions, and core paths polluted by rare edge cases; isolate special behavior with special-general decomposition.
- Combine or split by total complexity, not by size, runtime order, habit, or aesthetics. Keep related state, behavior, invariants, and design decisions together unless the new boundary is deeper and independently understandable.
- Reduce exception surface by changing interfaces or invariants where possible. Define away invalid states and awkward cases instead of making every caller repeat defensive ceremony.
- Use comments to reduce complexity: document interface contracts, invariants, hidden design decisions, rationale, and tricky implementation facts callers should not need to know. Do not narrate code or compensate for bad names, poor decomposition, or confusing flow.
- Treat names, consistency, and obviousness as design information. Names should reveal abstractions rather than mechanisms; related operations should share conventions; surprising code is complexity even when short.
- Use tests to protect behavior through public contracts and stable APIs, especially around hidden complexity and isolated special cases. Do not let test convenience force shallow or leaky interfaces.
- Add performance optimizations, trends, paradigms, patterns, or frameworks only when they reduce complexity in this codebase or evidence shows the tradeoff matters; hide optimization details behind stable interfaces.

## Trigger rules

- When a feature feels awkward, one change spreads across files, or reviewers must reconstruct hidden dependencies, look for missing information hiding, shallow modules, temporal coupling, or complexity pushed to callers.
- When adding a module, layer, service, helper, wrapper, facade, pattern, option, callback, or argument, prove that it hides more complexity than it adds.
- When touching an API, check whether ordinary callers must know sequencing, representation, storage, transport, caching, protocol, file format, internal workflow, or too many setup steps.
- When adding a special case, flag, exception path, conditional, or exposed container, first ask whether the owning module can eliminate the invalid state, isolate the unusual behavior, or provide a stronger operation.
- When splitting, extracting, or introducing variables, check whether the new boundary or name captures meaning or only adds jumps, pass-through state, and visible intermediate steps.
- When code is organized as `prepare/process/finalize`, staged objects, or other execution-order phases, verify that temporal structure is the real concept; otherwise reorganize around stable responsibilities.
- When naming is vague, mechanism-focused, inconsistent, or surprising, reconsider the abstraction boundary instead of accepting a near miss.
- When comments get long, duplicate code, justify a confusing interface, or explain usage by exposing internals, redesign the abstraction or move the missing contract to the interface.
- When optimizing performance, measure first and hide the optimization; do not sacrifice module depth or information hiding without evidence that the tradeoff matters.
- When testing or reviewing, focus on public behavior, interface contracts, hidden complexity through stable APIs, and special cases isolated behind the abstraction.

## Final checklist

- Did the change reduce the effort required to understand, modify, verify, and extend the system?
- Does every interface element, wrapper, layer, helper, option, and name hide enough complexity to justify its existence?
- Are important decisions localized, dependencies visible, caller-needed constraints documented, and mutable internals protected?
- Did common cases become automatic while rare controls, special cases, performance tricks, and exception details stayed out of the common path?
- Are names precise and consistent, comments current and non-duplicative, and conventions followed unless new information justified changing them?


---

## Clean Architecture

- **Author**: Robert C. Martin
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (515 lines / 17 KB) | Mini (49 lines / 5 KB) | Nano (36 lines / 2 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Clean Architecture by Robert C. Martin

## When to use

Use when tight context still needs to prevent framework-first design, database-shaped policy, layer bypass, or fake boundaries.

## Primary bias to correct

Details are plugins to policy, not the center of the design.

## Decision rules

- Source dependencies point inward. Domain and use cases must not import frameworks, databases, web, UI, queues, service clients, device, vendor, or infrastructure details.
- Entities guard enterprise invariants; focused use cases orchestrate application actions with plain input and output models.
- Frameworks, databases, web delivery, messaging, filesystems, clocks, networks, services, and hardware sit behind policy-owned ports and outer-layer adapters.
- Controllers, presenters, gateways, service listeners, mappers, and hardware adapters translate; they do not own business rules.
- Organize by use case, feature, or business capability. Avoid generic technical buckets, god services, shared utility escape hatches, and sideways coupling.
- Choose the lightest enforceable boundary that preserves likely change independence; a service, package, diagram, or folder name is not enough.
- Test policy through entities, use cases, and boundary contracts without real frameworks, databases, networks, services, or hardware.

## Trigger rules

- When framework, ORM, request, response, schema, transport, config, vendor, or hardware types enter core policy, move translation outward.
- When controllers, jobs, handlers, gateways, repositories, SQL, presenters, service listeners, or `*Service` classes grow business rules, move policy inward and split by use case.
- When core code constructs or calls volatile details directly, define an inward-owned port and wire the concrete implementation at the edge.
- When a shortcut bypasses a use case, crosses layers, creates a cycle, or hides coupling in `common` or `utils`, restore dependency direction and ownership.
- When constraints force a compromise, keep it outermost, name the violation, and preserve a future path to separation.

## Final checklist

- Policy independent of details?
- Dependencies inward?
- Use cases visible?
- Adapters humble?
- Boundaries enforced?
- Core tests detail-free?


### Mini Rules Specification

# OBEY Clean Architecture by Robert C. Martin

## When to use

Use when adding, changing, reviewing, or refactoring code whose business rules should survive changes in frameworks, databases, delivery mechanisms, services, devices, vendors, deployment shape, or schedule pressure.

## Primary bias to correct

Do not let details become the architecture. Business policy stays independent, dependencies point inward, and volatile mechanisms remain replaceable.

## Decision rules

- Preserve independent business rules, inward dependencies, testability, and replaceable details even when the immediate feature would be shorter without them.
- Source dependencies must point inward toward higher-level policy. Domain and use cases must not import frameworks, databases, web handlers, queues, external service clients, UI types, or other details.
- Put enterprise rules and invariants in entities or equivalent domain objects; put application-specific orchestration in focused use cases.
- Pass plain request and response models across use-case boundaries. Do not pass web requests, framework contexts, ORM rows, database-bound structures, or framework response objects into or out of core policy.
- Treat frameworks, databases, web delivery, messaging, filesystems, clocks, service clients, networks, devices, and vendors as outer-layer details behind ports, gateways, presenters, mappers, or adapters.
- Inner layers own the interfaces they need; outer layers implement them. Object construction and concrete wiring belong in the composition root or other outer-layer main component.
- Keep adapters humble. Controllers, endpoints, presenters, gateway adapters, service listeners, and hardware adapters translate external formats to use-case calls and back; they do not own business decisions.
- Organize by use case, feature, or business capability before generic technical buckets. The structure should reveal domain intent and application actions.
- Choose boundaries by volatility, policy importance, substitution value, testability, and cost. Use the lightest enforceable boundary, including partial boundaries, when full deployment or runtime separation is too expensive.
- Do not merge unrelated use cases or eliminate duplication when sharing would couple actors, change reasons, team ownership, deployment needs, or release pressure.
- Use structured code, dependency inversion, role-sized interfaces, substitutable implementations, controlled mutation, acyclic components, and stability-directed dependencies to protect policy from volatile details.
- Enforce boundaries with package structure, dependency rules, build constraints, tests, visibility, or narrow APIs. A diagram, service split, package name, or shared `common` folder is not enough.
- Test entities, use cases, and boundary contracts first, without the real framework, database, network, external service, or target hardware. Test adapters separately at the seams.
- Preserve behavior while improving dependency direction. Prefer incremental boundary extraction over rewrites, and call out architectural debt when it cannot be fixed safely now.

## Trigger rules

- When urgent delivery would skip architecture, state the future change, test, replacement, or operational cost before accepting the shortcut.
- When framework annotations, request/response objects, serializers, ORM rows, schemas, vendor SDKs, config, environment reads, device registers, or transport formats enter core policy, move translation outward.
- When controllers, jobs, handlers, views, presenters, gateways, repositories, SQL, service listeners, scripts, or hardware adapters contain business branching or validation, move the rule inward.
- When a use case instantiates infrastructure, calls a volatile dependency directly, or depends on a concrete implementation, introduce a policy-owned port and wire the concrete detail at the edge.
- When a `*Service`, utility folder, shared module, base package, or generic `core` package becomes an escape hatch, split by use case, role, or ownership and restore dependency direction.
- When an adapter bypasses a use case, a presenter reads persistence directly, or infrastructure is both imported by and importing inward code, restore the intended boundary.
- When service boundaries, process boundaries, remote calls, deployment boundaries, or embedded hardware appear, still verify source dependencies, data ownership, I/O cost, and policy independence.
- When tests need the framework, database, network, service, or hardware to verify business rules, move tests to use cases/entities with fakes or add a stable boundary contract.
- When a compromise is unavoidable, keep it at the outermost layer possible, document the violation, avoid normalizing it, and preserve a path to separation.

## Final checklist

- Business rules independent from frameworks, databases, UI, services, devices, and vendors?
- Dependencies point inward, with ports owned by inner policy and concrete details outside?
- Entities guard invariants and focused use cases orchestrate one application action?
- Boundaries explicit and enforced in code, tests, packages, or build rules?
- Controllers, presenters, gateways, service listeners, and adapters humble?
- Structure reveals use cases and business capabilities instead of generic technical buckets?
- Core tests run fast without real delivery, persistence, network, external service, or hardware?
- Details remain replaceable without rewriting business rules?


---

## Clean Code

- **Author**: Robert C. Martin
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (297 lines / 13 KB) | Mini (47 lines / 3 KB) | Nano (32 lines / 1 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Clean Code by Robert C. Martin

## When to use

Use when you need a small always-on bias toward readable, low-surprise code.

## Primary bias to correct

Working code is not automatically clean code.

## Decision rules

- Preserve behavior, write for the next reader, and leave touched code cleaner within scope.
- Write for local reasoning and use precise names with one term per concept.
- Split boolean flags, mixed abstraction levels, and hidden side effects out of functions.
- Separate commands from queries and keep parameters small and meaningful.
- Keep the happy path readable; make invalid states, errors, and cleanup explicit instead of implicit.
- Use comments only for rationale or contracts, not to explain confusing code.
- When touching code, remove the smell most likely to make the next change risky or unclear.

## Trigger rules

- When a function both mutates and answers, split it.
- When a comment explains the flow, simplify the code first.
- When async, concurrency, or framework quirks spread the change, reduce shared mutable state and add the right boundary instead of more branching.

## Final checklist

- Local reasoning preserved?
- Clear names?
- Clear mutation boundaries?
- One smell removed?


### Mini Rules Specification

# OBEY Clean Code by Robert C. Martin

## When to use

Use when readability, local reasoning, and maintainable code shape are the main concerns, especially during everyday implementation and review.

## Primary bias to correct

Working code is not automatically clean code.

## Decision rules

- Treat cleanliness as part of delivery. Preserve behavior, leave touched code cleaner within scope, and do not add mess because the schedule is tight or a rewrite is promised.
- Write for local reasoning. A reader should understand the path without reconstructing hidden state, wide jumps, or naming trivia.
- Use precise names and one term per concept. Rename code when vocabulary hides intent, overloads meaning, or forces comments to compensate.
- Keep functions small, focused, and at one level of abstraction. Tell the story top-down so intent appears before detail.
- Keep parameters few and meaningful. Avoid boolean flags, output parameters, and grab-bag argument lists; model the concept instead.
- Separate commands from queries and eliminate hidden side effects. A function that answers should not also mutate behind the reader's back.
- Keep the happy path readable. Isolate error handling, invalid-state handling, and cleanup; prefer explicit optionality or typed results over null-like sentinel flow when the language supports it.
- Expose behavior rather than raw representation. Avoid train-wreck access, utility dumping grounds, and classes or modules with mixed responsibilities.
- Keep construction, framework, persistence, transaction, security, and vendor details outside business behavior.
- Make public APIs small, explicit, and hard to misuse. Encode boundary logic, required order, and likely changes where readers can see them.
- Use comments only for rationale, constraints, warnings, or external contracts. Do not narrate code instead of improving it.
- Treat tests as production code: readable, deterministic, aligned with the behavior or contract they protect, and backed by proportionate validation before calling the change done.
- Let design emerge through tests, duplication removal, expressiveness, and minimal structure; do not add needless abstractions or infrastructure.
- When touching code, remove the smell that most increases change cost, but do not silently broaden the task beyond the smallest cleanup that makes the requested change safe.

## Trigger rules

- When a function mixes setup, validation, computation, and side effects, split the phases.
- When a comment explains control flow, simplify names or structure before keeping the comment.
- When a function both mutates and answers, or hides a mode switch behind a flag, separate the responsibilities.
- When duplication, repeated switches, or primitive clusters appear, name the concept with an argument object, polymorphism, special case, or other small abstraction.
- When a boundary leaks framework, vendor, or persistence quirks inward, add or strengthen a local adapter.
- When async or concurrency enters, isolate threading policy, minimize shared mutable state, define shutdown, and test timing-sensitive behavior.
- When fixing a bug or changing behavior, add or update the test that protects the intended contract.
- When cleanup starts spreading into unrelated areas, cut back to the smallest refactor that keeps the requested change safe and readable.

## Final checklist

- Can a reader follow the change locally?
- Are names and APIs carrying the meaning without narration?
- Is mutation explicit and the happy path still clear?
- Did framework, persistence, vendor, and construction details stay behind boundaries?
- Did I remove at least one smell from the touched area?
- Do tests protect the changed behavior or contract?
- Did I actually run the relevant tests or checks for this change?


---

## Code Complete (2nd Edition)

- **Author**: Steve McConnell
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (354 lines / 12 KB) | Mini (56 lines / 6 KB) | Nano (41 lines / 2 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Code Complete by Steve McConnell

## When to use

Use as a compact always-on construction discipline for implementation, review, debugging, refactoring, and tuning.

## Primary bias to correct

Working code is not enough. Construction must lower defect risk, control complexity, and make human inspection cheap.

## Decision rules

- Clarify requirements, architecture fit, risks, conventions, and major construction decisions before coding from a solution idea.
- Choose clarity, locality, explicitness, simple control flow, and consistent style over clever compactness or fashionable idioms.
- Keep routines, classes, and modules cohesive, precisely named, small at the interface, encapsulated, and hard to misuse.
- Make data meaning visible with names, constants, stronger types, closed states, deliberate initialization, units, and ownership.
- Validate trust boundaries; use assertions, invariants, and contracts for programmer assumptions; keep error handling explicit and diagnosable.
- Keep branches, loops, exits, exceptions, and table-driven logic simple enough to verify.
- Build, test, review, debug, refactor, integrate, and tune in small evidence-based loops: root cause before fixes, behavior protection before refactoring, measurement before optimization.
- Use comments, documentation, tools, and standards to reduce reader or manual effort, never to hide poor structure.

## Trigger rules

- When a solution appears before the problem is clear, restate the requirement, constraints, and construction risks.
- When readers must decode names, flags, primitives, units, states, or layout, model the meaning explicitly.
- When a routine mixes phases or has a hard-to-use interface, split concerns or change the data model.
- When input crosses a trust boundary, decide validation, rejection, recovery, assertion, and diagnostics.
- When control flow, loops, exceptions, or branching tables are hard to inspect, simplify before adding logic.
- When tests only prove happy paths, add boundary, invalid-input, defensive-check, contract, and data-driven cases.
- When debugging, refactoring, or performance work starts from a guess, get evidence first.
- When comments repeat obvious mechanics, rewrite the code or delete the comment; keep comments for intent and constraints.

## Final checklist

- Clear construction context?
- Inspectable code shape?
- Explicit data meaning?
- Defended boundaries and diagnosable failures?
- Simple flow?
- Defect-finding tests and reviews?
- Evidence before fixes, refactors, and tuning?


### Mini Rules Specification

# OBEY Code Complete by Steve McConnell

## When to use

Use when implementing, changing, reviewing, debugging, refactoring, or tuning production code where construction discipline must reduce defects and keep code easy to inspect.

## Primary bias to correct

Construction quality is not accidental. Do not treat typing code, making it work once, or using a clever idiom as complete construction; choose the option that lowers defect risk and makes the code easier to reason about.

## Decision rules

- Before large construction work, verify that requirements, architecture, major risks, coding conventions, language constraints, error policy, data representation, reuse, integration, and testing approach are clear enough.
- When upstream uncertainty remains, build a small validated slice instead of speculative code, and make expensive-to-reverse decisions deliberately.
- Optimize first for human readers: clarity, locality, explicitness, visible control flow, consistent conventions, and practical correctness over cleverness, minimal keystrokes, or fashion.
- For complex routines, sketch precise pseudocode or intent comments at a consistent abstraction level, then convert them into code and keep only comments that still explain intent, constraints, contracts, or rationale.
- Keep routines cohesive, precisely named, small at the interface, and hard to misuse. Separate setup, validation, computation, and side effects when they are conceptually different.
- Make variable and data meaning explicit through purpose-revealing names, small scope, deliberate initialization, named constants, stronger types, and visible units or sentinel meanings.
- Choose data types that make invalid or ambiguous values harder to represent; use booleans only for true binary meanings, enumerations for closed sets, and records/maps/tables only when their shape communicates meaning.
- Keep control flow simple enough to verify: shallow nesting, named predicates for complex conditions, clear normal path, clear loop initialization/termination/update, and no side-effect-dependent expressions or clever one-liners.
- Use table-driven or data-driven logic for stable explicit mappings only when the table is clearer, obvious, synchronized with the rules, and validated; do not hide complex behavior in inscrutable encodings.
- Validate input at trust boundaries. Use assertions, invariant checks, and simple contracts for programmer assumptions; use validation or domain errors for expected external or business failures.
- Handle errors at the right abstraction, preserve diagnostic context, standardize similar failures, keep the normal path readable, and never silently continue from corrupted or impossible state.
- Keep classes and modules focused, cohesive, and bounded by clear contracts; hide representation and internal bookkeeping, and avoid mixed persistence, formatting, business, and integration concerns.
- Treat rising complexity as defect risk: split tangled routines or modules, remove duplication that multiplies maintenance effort, and reduce what a maintainer must keep in working memory.
- Build in small, verifiable increments; integrate often enough to expose conflicts, keep partial work from rotting, and review and improve code during construction.
- Match reviews, inspections, pair work, tests, static checks, and regression tests to defect risk. Debug by reproducing, isolating, explaining, fixing, and verifying root causes rather than guessing.
- Refactor when structure hides intent, duplicates knowledge, or raises defect probability, and keep refactoring separate from behavior change when that improves reviewability.
- Tune performance only when requirements and evidence justify it; measure before and after, and keep clarity unless an explicit measured tradeoff warrants the cost.
- Use tools, scripts, debuggers, profilers, editors, and build automation to reduce error-prone manual work, not to replace understanding.
- Use layout, comments, documentation, and coding standards to lower reader effort. Prefer self-documenting structure first; comments should explain intent, assumptions, constraints, limitations, usage, or non-obvious facts.

## Trigger rules

- When coding starts from a proposed solution, restate the requirement, architecture fit, risks, conventions, and success constraints before implementation.
- When a routine is hard to name, mixes phases, has flag arguments, long parameters, or hidden side effects, redesign the interface or split the routine.
- When readers must decode units, ranges, precision, encoding, ownership, status, magic values, or primitive flags, move that meaning into names, constants, types, or structures.
- When input crosses a user, file, network, external-system, or other trust boundary, decide what is validated, rejected, recovered from, asserted, and kept diagnosable.
- When branches, loops, recursion, exits, or exception paths become hard to verify, simplify before adding logic.
- When repeated branching maps stable categories, ranges, conversions, validation, dispatch, or configuration-like rules, consider a validated table.
- When a class or module exposes representation, grows into a god object, or mixes unrelated responsibilities, restore the abstraction boundary.
- When tests cover only the happy path, add normal, boundary, invalid-input, defensive-check, routine-contract, and data-driven edge cases.
- When debugging begins from a guess, first make the failure repeatable, collect evidence, isolate the path, and explain the cause.
- When refactoring poorly understood or risky code, add tests or analysis first and keep behavior changes separate.
- When performance work begins, set a target, measure the current behavior, change one thing, remeasure, and document any clarity tradeoff.
- When comments restate obvious mechanics or go stale, rewrite the code or delete the comment; when code cannot express intent, constraints, or usage, add a close accurate comment.
- When local style starts to diverge, follow shared formatting, naming, file-structure, and idiom conventions instead of creating a module-specific dialect.

## Final checklist

- Requirements, architecture fit, risks, conventions, and construction approach are clear enough.
- Names, routines, data, classes, layout, comments, and standards reduce reader effort.
- Inputs, errors, assertions, contracts, invariants, impossible states, and trust boundaries are deliberate.
- Control flow, loops, tables, recursion, exits, and exception paths are simple enough to inspect.
- Tests, reviews, debugging, refactoring, integration, tooling, and tuning are evidence-based.
- The change is small enough to verify and would stand up to careful review.


---

## Designing Data-Intensive Applications

- **Author**: Martin Kleppmann
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (393 lines / 15 KB) | Mini (55 lines / 6 KB) | Nano (34 lines / 2 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Designing Data-Intensive Applications by Martin Kleppmann

## When to use

Use when data correctness, durability, or distributed write semantics matter more than local code style.

## Primary bias to correct

Hidden data contracts are still contracts.

## Decision rules

- State the source of truth, consistency expectation, durability point, visibility point, retry semantics, and evolution path for every important data change.
- Choose data models, storage, indexes, replication, partitioning, transactions, queues, streams, and APIs from workload, access pattern, consistency, reliability, maintainability, and operational cost.
- Treat caches, indexes, projections, search copies, denormalized data, and materialized views as derived data with staleness, lag visibility, repair, and rebuild paths.
- Make retried, replayed, queued, batch, stream, and event-driven work idempotent or transactional; reject casual exactly-once claims.
- Treat schemas, encodings, service APIs, messages, logs, and events as versioned contracts that must survive old code, old data, rolling upgrades, and in-flight messages.
- Assume distributed uncertainty: crashes, partial writes, timeouts, duplicate messages, reordered events, stale replicas, lag, clock error, pauses, stale leaders, and unknown success.
- Match replication, partitioning, isolation, transactions, and coordination to the invariant; do not rely on follower freshness, quorum formulas, weak isolation, wall-clock order, or ad hoc leadership without proof.

## Trigger rules

- When adding retries, jobs, consumers, queues, CDC, event sourcing, or stream processing, prove duplicate, replay, ordering, side-effect, and recovery safety.
- When changing schemas, APIs, messages, events, enum values, or status meanings, plan backward and forward compatibility plus migration, bootstrap, or rebuild paths.
- When reading from replicas or partitioning data, define staleness, routing, hot-key, ordering, rebalancing, and cross-partition behavior.
- When using locks, leases, timestamps, leadership, majorities, or coordination services, define the fault model, quorum/session semantics, stale-authority behavior, and fencing.

## Final checklist

- Clear owner and source of truth?
- Explicit consistency, durability, visibility, and staleness semantics?
- Safe under retry, replay, duplicate delivery, reordering, and unknown success?
- Compatible across old data, old code, new code, and messages in flight?
- Isolation, replication, partitioning, transactions, and coordination checked against actual invariants?


### Mini Rules Specification

# OBEY Designing Data-Intensive Applications by Martin Kleppmann

## When to use

Use for systems where correctness depends on data ownership, consistency, durability, replication, partitioning, schema evolution, event flow, replay, or derived-data maintenance.

## Primary bias to correct

Do not design distributed data behavior as if every write, read, queue, cache, replica, clock, and downstream side effect were local, ordered, fresh, and exactly once.

## Decision rules

- Make core trade-offs explicit: source of truth, consistency expectation, retry behavior, duplicate and reordered work, partial failure, data evolution, and whether state is durable, cached, derived, or ephemeral.
- Treat crashes, partial writes, duplicate work, timeouts, stale reads, and unknown downstream success as normal inputs. Distinguish accepted, persisted, applied, and durable success.
- Describe load and performance with concrete request rates, data volume, access patterns, latency, throughput, percentiles, bottlenecks, contention, and tail behavior before changing architecture.
- Choose data models, query models, and ownership boundaries from relationships, access patterns, consistency needs, update locality, evolution pressure, and whether data is primary or derived.
- Match storage engines, indexes, and analytical layouts to write patterns, read patterns, range scans, recovery needs, write amplification, OLTP-vs-analytics separation, and memory-vs-durability assumptions.
- Treat indexes, caches, search copies, read models, materialized views, and denormalized copies as derived data with explicit propagation, lag, observability, repair, and rebuild paths.
- Define write semantics: when a write is durable, when it is visible, whether stale reads are allowed, which conflicts can happen, and how conflicts are detected or resolved.
- Make commands, jobs, events, batch jobs, and stream processors safe under retry and replay with deduplication keys, naturally idempotent transitions, or an explicit transactional recovery contract.
- Preserve only the ordering the business logic actually needs. Scope it per key, stream, partition, record, entity history, or stronger contract, and keep ordering-sensitive logic close to that scope.
- Separate commands, events, durable logs, streams, and materialized views. Events describe facts; consumers must tolerate lag, duplicates, restart, replay, stable identifiers, correlation metadata, and versioned payloads.
- Design schemas, encodings, APIs, messages, events, and database changes as evolving contracts across old readers, old writers, old data, in-flight messages, rolling upgrades, and cross-service formats.
- Choose replication topology from write topology, latency, failure tolerance, lag, failover, reconfiguration, conflict handling, read-your-writes, monotonic-read, consistent-prefix, quorum, and convergence needs.
- Partition by workload-relevant locality and consistency keys, with hot-key, skew, routing, secondary-index, rebalancing, and cross-partition-operation costs explicit.
- Match transactions and isolation to invariants. Make atomicity scope, commit behavior, recovery, reconciliation, lost-update, write-skew, phantom, and side-effect repair semantics explicit.
- Treat network delay, packet loss, partitions, duplicate messages, pauses, stale leaders, timeouts, wall-clock uncertainty, leases, locks, majorities, and leadership as assumptions needing a fault model.
- Use linearizability, total order broadcast, atomic commit, or consensus only where the coordination problem truly requires agreement and the availability or latency cost is acceptable.
- Make batch and stream processing recomputable and recoverable: define inputs, outputs, intermediate state, checkpoints, external side effects, event time, processing time, ingestion time, windows, late data, joins, and source-to-sink guarantees.
- Align service boundaries with data ownership and update semantics. Do not casually split one tightly consistent business concept across services or put chatty cross-service joins on hot paths.

## Trigger rules

- When changing a write path, state the source of truth, consistency boundary, durability point, visibility point, downstream effects, rollback or repair path, and behavior after timeout or unknown success.
- When adding or changing a cache, index, projection, search copy, read model, warehouse, or denormalized field, define ownership, propagation, staleness, write cost, lag visibility, rebuild, and repair.
- When changing a schema, API, message, event, enum, status, or payload meaning, plan compatibility for old readers, old writers, old stored data, old messages, new writers, rollout, and migration.
- When adding retries, jobs, consumers, queues, CDC, event sourcing, stream processors, or replayable batch work, prove duplicate, replay, ordering, retention, side-effect, and recovery safety.
- When routing reads to replicas or using asynchronous replication, identify read-your-writes, monotonic-read, consistent-prefix, staleness, catch-up, failover, and conflict expectations before allowing the read.
- When partitioning data or work, test the ordinary query path for locality, skew, hot keys, routing metadata, rebalancing cost, secondary-index behavior, and cross-partition coordination.
- When choosing transaction isolation or weakening consistency, map each anomaly to the invariant it can break and add serializable isolation, locks, compare-and-set, versioning, reconciliation, or another compensating design where needed.
- When using timestamps, leases, locks, leadership, majority decisions, coordination services, or consensus-like mechanisms, define the clock assumption, quorum/session semantics, stale-authority behavior, and fencing.
- When reviewing or testing data-intensive code, look specifically for hidden source-of-truth ownership, missing idempotency, accidental exactly-once assumptions, unscoped ordering, schema drift, unrebuildable projections, unclear multi-writes, and unobservable lag or failure.

## Final checklist

- Source of truth and derived representations are explicit.
- Consistency expectations, durability points, visibility points, staleness, and conflict rules are concrete.
- Retries, duplicate delivery, replay, reordering, timeouts, crashes, and unknown success are handled.
- Schemas, encodings, APIs, messages, events, enums, and statuses evolve safely across mixed versions.
- Storage, indexing, replication, partitioning, routing, and analytical layouts match the actual workload.
- Transaction isolation and coordination choices protect the named invariants.
- Events, logs, streams, batch jobs, and projections are replayable or have explicit repair paths.
- Service boundaries follow data ownership and update semantics.
- Lag, retries, failures, rebuilds, and repair paths are observable.
- The design avoids exactly-once wishful thinking and hidden distributed-system contracts.


---

## Domain-Driven Design

- **Author**: Eric Evans
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (979 lines / 41 KB) | Mini (48 lines / 5 KB) | Nano (39 lines / 2 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Domain-Driven Design by Eric Evans

## When to use

Use as always-on DDD guidance when domain language, invariants, lifecycle, or integration boundaries affect implementation choices.

## Primary bias to correct

Generic plumbing and DDD terminology are not a domain model.

## Decision rules

- Keep model, code, tests, documents, and team language aligned inside each Bounded Context.
- Make business behavior explicit in model code, not hidden in controllers, persistence, jobs, scripts, or framework glue.
- Refine Ubiquitous Language when terms are fuzzy, and use only models that solve the problem and can be implemented.
- Use tactical patterns for domain meaning: Entities for identity, Value Objects for value, Services for homeless operations, and Modules for conceptual cohesion.
- Treat Aggregates as consistency and lifecycle boundaries; expose roots only and protect invariants inside the boundary.
- Hide complex creation and persistence behind Factories and Repositories; design for the model first and storage second.
- Define context boundaries and relationships explicitly before sharing terms, data, or behavior across systems.
- Protect the Core Domain from generic subdomains, reusable mechanisms, infrastructure, framework pressure, and foreign models.
- Refactor toward deeper insight: make important constraints, policies, processes, and calculations explicit domain concepts.
- Test invariants, invalid construction, lifecycle transitions, and boundary translations in the Ubiquitous Language.

## Trigger rules

- Fuzzy or inconsistent terms trigger language refinement and code renaming.
- Procedural business rules in orchestration, SQL, jobs, or serializers trigger moving behavior into the model.
- Sprawling transactions or cross-module changes trigger Aggregate and context-boundary review.
- Foreign model, schema, API, or legacy pressure triggers translation or an explicit Conformist choice.
- Supporting mechanisms obscuring distinctive value trigger Core Domain distillation.

## Final checklist

- Domain behavior in the model?
- One language per context?
- Invariants protected by roots and values?
- Integration relationship explicit?
- Domain tests cover invalid states and translations?
- Core Domain still visible?


### Mini Rules Specification

# OBEY Domain-Driven Design by Eric Evans

## When to use

Use when business complexity, model language, lifecycle rules, or cross-team/system boundaries shape the design more than generic technical organization.

## Primary bias to correct

Keep domain behavior, code, tests, documents, and team language aligned inside explicit Bounded Contexts. Do not let persistence, UI, frameworks, integration formats, or DDD vocabulary replace an implementation-driving model.

## Decision rules

- Use a model only when it organizes domain knowledge, clarifies communication, and can be expressed in implementation; iterate through code, expert conversation, scenarios, and refactoring toward deeper insight.
- Maintain one Ubiquitous Language per Bounded Context across names, tests, documents, diagrams, planning, and feature discussion; keep explanatory models separate from the implementation model.
- Put business logic in the domain layer. Keep UI, application coordination, infrastructure, persistence, messaging, and framework constraints outside the model or behind adapters.
- Use tactical patterns for model meaning: Entities for stable identity, Value Objects for immutable descriptive value, Services for important operations with no natural object home, and Modules for conceptual cohesion.
- Manage lifecycle through Aggregates, Factories, and Repositories: expose only Aggregate roots, enforce invariants inside the boundary, hide complex creation and persistence, and prevent partially formed objects from escaping.
- Design domain objects for the model first and persistence second; preserve identity, Aggregate boundaries, Value Object semantics, and domain query criteria instead of exposing database structure.
- Refactor toward deeper domain insight, not only mechanical cleanliness. Make constraints, policies, processes, calculations, allocations, and generation rules explicit when they carry domain meaning.
- Design for model users: name operations by domain purpose, separate side-effect-free functions from state-changing commands, make assertions explicit, and shape boundaries around conceptual contours.
- Define every Bounded Context explicitly. Do not assume a term has the same meaning elsewhere; use context maps, tests, and active communication to protect model integrity.
- Choose context relationships deliberately: Shared Kernel, Customer/Supplier, Conformist, Anticorruption Layer, Separate Ways, Open Host Service, Published Language, or incremental legacy replacement.
- Distill and protect the Core Domain by strategic value. Keep generic subdomains, infrastructure, reusable mechanisms, and supporting details from consuming core-domain attention.
- Add large-scale structure only when individual objects no longer make a large model understandable; keep structures domain-specific, evolvable, and valid only inside compatible contexts.
- Use analysis patterns, design patterns, specifications, industry formalisms, and prior art only when they clarify the current model and preserve domain language.
- Test the model in the Ubiquitous Language: prioritize domain tests for invariants, allowed and forbidden transitions, valid construction, specifications, application orchestration, and boundary translation before generic infrastructure checks.
- Make major strategic moves with people who understand both the implementation and the domain; architecture and framework guidance must serve application teams and domain goals.

## Trigger rules

- When terminology is awkward, ambiguous, inconsistent, or repeatedly translated, refine the Ubiquitous Language and rename code before adding more behavior.
- When controllers, services, scripts, SQL, jobs, or serializers carry business decisions, move rules into domain objects, domain services, specifications, or explicit domain concepts.
- When UI, persistence, messaging, APIs, or frameworks start shaping domain concepts, isolate them with layers, adapters, translation, or an Anticorruption Layer.
- When a change crosses unrelated modules, many objects, or multiple roots, reassess Module cohesion, Aggregate ownership, consistency timing, and context boundaries.
- When clients know creation, lifecycle, persistence, identity generation, or internal mutation details, repair Factories, Repositories, roots, and encapsulation.
- When new behavior is hard to explain, test, or extend, search for a deeper model, missing implicit concept, or breakthrough refactoring instead of adding procedural branches.
- When integrating with another model, choose the relationship, translation strategy, published language or protocol, and boundary tests before writing boundary code.
- When changing invariants, lifecycle transitions, specifications, orchestration, or context translation, add domain-language tests that prove valid behavior and block invalid states.
- When generic mechanisms, reusable frameworks, or supporting subdomains obscure distinctive value, distill the Core Domain or separate the mechanism.

## Final checklist

- Is domain behavior explicit in the model rather than hidden in delivery, persistence, or integration code?
- Do code, tests, documents, and conversations use one language inside each Bounded Context?
- Do tactical patterns protect identity, value semantics, lifecycle, invariants, and responsibility instead of adding ceremony?
- Does every cross-context integration have an explicit relationship, translation strategy, and boundary test?
- Do tests read like executable examples of the model and cover invalid transitions or construction?
- Is the Core Domain visible and protected from supporting complexity, generic mechanisms, infrastructure, and frameworks?


---

## Domain-Driven Design Distilled

- **Author**: Vaughn Vernon
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (317 lines / 11 KB) | Mini (56 lines / 6 KB) | Nano (41 lines / 2 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Domain-Driven Design Distilled by Vaughn Vernon

## When to use

Use as compact DDD guidance when business language, context ownership, invariants, or integration meaning can affect the code.

## Primary bias to correct

DDD is selective modeling for real business complexity, not decorative layers, framework shape, or blanket tactical ceremony.

## Decision rules

- Start from business capability, subdomain type, Bounded Context, and local Ubiquitous Language before tactical patterns.
- Invest most design effort in the Core Domain; keep Supporting, Generic, CRUD, and mainly technical areas simpler.
- Put every meaningful model inside one explicit Bounded Context that owns its language, rules, semantics, code, tests, and integration contracts.
- Translate between contexts when meanings differ; never share domain classes or terms whose meanings diverge.
- Choose context relationships and integration mechanisms deliberately, including Conformist or Anticorruption Layer when foreign meaning is involved.
- Keep integration contracts separate from internal models, and do not expose Aggregate internals through REST or transport payloads.
- Use Entities for identity, Value Objects for validated meaning, Aggregates for small invariant boundaries, and Domain Events for meaningful past-tense facts.
- Modify one Aggregate per transaction by default; reference other Aggregates by identity and use eventual consistency when the business allows it.
- Keep business decisions in the domain model; Application Services coordinate use cases.
- Keep frameworks, persistence, transport, and external schemas out of the domain model.
- Use scenarios, acceptance tests, Event Storming, spikes, and domain-expert walkthroughs to learn quickly without hiding modeling debt.

## Trigger rules

- When language is fuzzy or overloaded, sharpen terms before coding.
- When one model absorbs unrelated concerns, redraw the subdomain or context boundary.
- When foreign models, schemas, APIs, or frameworks drive domain shape, add boundary translation.
- When a transaction wants many roots or a large graph, revisit Aggregate boundaries and consistency timing.
- When services, controllers, setters, flags, or primitives carry business decisions, expose the missing domain concept.
- When events are vague, command-like, or noisy field changes, redesign them as specific business facts.

## Final checklist

- Clear subdomain?
- Clear context?
- Clear language?
- Clear translation?
- Clear invariant boundary?
- Clear modeling debt?


### Mini Rules Specification

# OBEY Domain-Driven Design Distilled by Vaughn Vernon

## When to use

Use when business software has enough domain complexity, language ambiguity, strategic differentiation, or integration risk that modeling changes implementation decisions, but the project still needs the smallest effective DDD practice rather than ceremony.

## Primary bias to correct

Use DDD selectively, but seriously. Start from business capability, subdomain importance, bounded context, and local language before tactical patterns, frameworks, persistence, APIs, or class shapes.

## Decision rules

- Before designing code, identify the business capability, classify the subdomain as Core, Supporting, or Generic, define the Bounded Context, use its Ubiquitous Language, and choose only tactical patterns that earn their cost.
- Put the most modeling effort into the Core Domain. Keep Supporting and Generic Subdomains simpler unless their own complexity proves otherwise.
- Do not apply full tactical DDD to simple CRUD, generic subsystems, or mainly technical problems; strengthen the model only when invariants, lifecycle, language complexity, or integration risk justify it.
- Give every meaningful model one explicit Bounded Context. The context owns its language, rules, semantics, code structure, tests, and integration contracts.
- Treat the same word in different contexts as potentially different concepts. Translate at context boundaries instead of sharing domain classes or leaking foreign language into the local model.
- Choose context relationships deliberately: Partnership, Shared Kernel, Customer/Supplier, Conformist, Anticorruption Layer, Open Host Service, Published Language, Separate Ways, or Big Ball of Mud containment all imply different ownership and translation duties.
- Select integration style from business coupling and failure semantics: RPC requires acceptable request/response coupling; REST resources must not expose Aggregate internals; messaging must tolerate lag, duplicates, and ordering limits.
- Keep integration contracts separate from internal models and test translations wherever meanings cross a boundary.
- Use local domain terms in code, tests, Commands, Domain Events, APIs, and conversations. One concept gets one term, one term does not carry multiple meanings inside a context, and code is renamed when understanding improves.
- Use Entities when identity and lifecycle matter; make identity explicit and protect meaningful state transitions rather than exposing unrestricted setters.
- Use immutable, self-validating Value Objects when primitives hide domain meaning.
- Use Aggregates only as invariant and transactional consistency boundaries. Keep them small, modify through the root, reference other Aggregates by identity, avoid large object graphs, and usually change one Aggregate per transaction.
- Use Domain Events for meaningful past-tense business facts that clarify collaboration or integration; do not publish noisy field-change events.
- Application Services coordinate use cases by loading Aggregates, invoking domain behavior, saving results, and triggering integration work. They must not become the real domain model.
- Keep frameworks, persistence mechanics, transport formats, REST representations, and infrastructure types out of the domain model. Translate external data at the boundary and persist Aggregates without letting storage define the model.
- Prefer code that teaches the model: make domain assumptions explicit in names, tests, and events; expose richer concepts instead of hiding meaning behind flags, status codes, booleans, enums, helpers, or utilities.
- Use Event Storming, scenarios, acceptance tests, modeling spikes, and domain-expert walkthroughs when workflow, terminology, policies, or acceptance criteria are unclear. Timebox modeling and track modeling debt instead of drifting into detached analysis.
- Estimate and plan DDD work from modeling uncertainty, integration risk, implementation cost, team skill, and access to domain experts, not only from feature count.

## Trigger rules

- When language is fuzzy, generic, overloaded, or imported from another context, pause coding and sharpen the local Ubiquitous Language.
- When the core concern drifts, terms stop matching code, or supporting complexity hides the core, reassess subdomains, boundaries, and modeling investment.
- When one model spreads across billing, identity, catalog, fulfillment, support, permissions, or other separate concerns, split or translate instead of reusing shared domain classes.
- When an upstream model, schema, UI, framework, API payload, transport object, or database shape starts defining the domain model, restore boundary translation.
- When using Shared Kernel, require small stable overlap, joint ownership, and tests; without governance, choose another relationship.
- When calling something an Anticorruption Layer, verify that real translation exists.
- When a request wants to load and mutate a large graph or several Aggregate roots, revisit the invariant boundary and ask whether eventual consistency is acceptable.
- When controllers, helpers, services, or transport-shaped application services contain business decisions, move behavior into the domain model or name the missing concept.
- When a Domain Event is command-like, vague, trivial, or emitted for every field change, redesign it as a specific business fact or remove it.
- When a concept is represented as a primitive, flag, status code, enum, or boolean but carries domain rules, promote it to a richer concept or Value Object.
- When delivery pressure tempts the team to skip design, use a short modeling spike, scenario, or acceptance test and record known modeling debt.

## Final checklist

- Correct subdomain and Core Domain investment?
- Explicit Bounded Context and relationship to neighboring contexts?
- Ubiquitous Language visible in code, tests, Commands, Events, APIs, and conversations?
- Translation tested where external or foreign meanings cross boundaries?
- Tactical patterns used only where they clarify meaning or protect invariants?
- Aggregates small, root-protected, identity-referenced, and not graph-shaped?
- Application Services coordinating rather than owning business logic?
- Infrastructure, persistence, REST, and transport details kept out of the domain model?
- Modeling discoveries, acceptance tests, expert input, and modeling debt captured before shipping?


---

## Implementing Domain-Driven Design

- **Author**: Vaughn Vernon
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (337 lines / 12 KB) | Mini (57 lines / 7 KB) | Nano (37 lines / 2 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Implementing Domain-Driven Design by Vaughn Vernon

## When to use

Use when tight context still needs DDD guardrails for context leakage, fake tactical patterns, Aggregate sprawl, and cross-context model coupling.

## Primary bias to correct

Local context, language, and invariants outrank reuse pressure, ORM convenience, object graph traversal, and framework or client shape.

## Decision rules

- Name the Bounded Context and local Ubiquitous Language before interpreting models, services, repositories, events, APIs, persistence, or integrations.
- Translate across contexts and foreign systems; never share local Aggregates, Entities, enums, or domain objects as integration contracts.
- Treat Aggregates as small immediate consistency boundaries with one root, hidden mutable internals, identity references to other Aggregates, and eventual consistency outside one boundary by default.
- Use Entities for identity and lifecycle, Value Objects for immutable validated descriptive values, and Domain Services only when no model object naturally owns the operation.
- Keep Repositories focused on Aggregate Roots and Application Services focused on use-case coordination rather than domain decisions.
- Publish Domain Events only as meaningful completed past-tense facts; use Event Sourcing only when event history is the right persistence model.
- Use DTOs, projections, use-case queries, adapters, and explicit scope identifiers instead of exposing or reshaping domain internals for clients.

## Trigger rules

- When a term is ambiguous, generic, or reused across contexts, split or qualify it by Bounded Context before coding.
- When one transaction or object graph wants multiple Aggregate roots, demand immediate-invariant proof; otherwise coordinate by identity, events, policies, processes, or Application Services.
- When foreign models, database shape, framework objects, transport payloads, UI needs, or another context's model leak into domain code, translate at the boundary.
- When DDD vocabulary appears around CRUD services, generic repositories, mutable graphs, or anemic models, require the real invariant and behavior or simplify the design.
- When reviewing DDD code, verify context, language, Aggregate boundary, translation, Repository shape, events-as-facts, and Application Service thinness before approving.

## Final checklist

- Clear Bounded Context and local language?
- Explicit translation instead of shared model types?
- Aggregate boundary backed by immediate invariants?
- Identity references across Aggregates?
- Repositories Aggregate-root focused?
- Application Services coordinating, not deciding?
- Client, persistence, and foreign concerns kept outside the domain model?


### Mini Rules Specification

# OBEY Implementing Domain-Driven Design by Vaughn Vernon

## When to use

Use when DDD implementation choices affect bounded contexts, language, aggregates, repositories, events, application services, package structure, or cross-context integration.

## Primary bias to correct

Practical DDD is not renamed CRUD. Model the operational domain inside an explicit Bounded Context, with local language, small invariant boundaries, identity references across Aggregates, and explicit translation across context and infrastructure boundaries.

## Decision rules

- Name the Bounded Context before interpreting terms, modules, services, repositories, events, APIs, persistence, or integrations; never force one global company model.
- Use the local Ubiquitous Language consistently: one concept gets one term inside the context, one term must not carry multiple meanings, and code, tests, events, commands, repositories, services, and packages must speak that language.
- Protect the Core Domain from generic abstractions and vendor terms; spend richer modeling where competitive or operational complexity lives, keep supporting subdomains simpler, and avoid DDD ceremony for trivial CRUD.
- Make every context interaction explicit: show the relationship, translation responsibility, and upstream/downstream influence before sharing data, terms, models, or integration code.
- Translate foreign, legacy, partner, external, and infrastructure models into the local language; keep foreign schemas, statuses, contract models, and aggregates out of local domain objects.
- Treat Aggregates as immediate consistency boundaries: keep them small, expose one root, route invariant-changing behavior through the root, hide mutable internals, and expose intention-revealing behavior instead of arbitrary setters.
- Reference other Aggregates by identity, avoid large connected object graphs, and default to one Aggregate per transaction; use events, policies, or process coordination when consistency can be eventual.
- Use Entities when identity and lifecycle matter, and make their methods protect meaningful state transitions rather than generic state changes.
- Use immutable Value Objects for meaningful descriptive concepts; validate at construction, compare by value, and replace raw primitives for meaningful identifiers, quantities, ranges, names, and whole values.
- Use Domain Services only for domain-significant operations that require multiple domain objects and fit no Entity or Value Object; keep technical transformation, serialization, transport, and persistence mapping outside the domain model.
- Provide Repositories for Aggregate Roots, not tables; define interfaces by domain or application needs, return domain objects or domain-oriented results, and keep business rules out of repository implementations.
- Publish Domain Events only for meaningful completed business facts; name them in the past tense, keep payloads local to the model, and do not use events for every property change or to hide poor Aggregate design.
- Use Event Sourcing only when the event sequence is the right persistence model; streams must match Aggregate identity and versioning, replay must be deterministic, and event meaning changes need versioning, upcasters, or translators.
- Keep Application Services as use-case coordinators: load Aggregates, invoke domain behavior, persist results, publish resulting events, own transaction or integration coordination, and keep core decisions in the domain model.
- Organize modules by Bounded Context first and by domain or use-case ownership within the context; avoid giant `shared` or `common` packages for domain concepts.
- Use DTOs, projections, use-case queries, rendition adapters, or mediators when client needs differ from Aggregate shape; expose application-facing representations rather than aggregate internals.
- Keep command behavior separate from query models when consistency, performance, or representation needs justify it, and keep scope identifiers explicit where context or ownership affects invariants or access.
- When generating code, walk the model in order: context, language terms, tactical type, conservative Aggregate boundary, identity references, local invariants, Aggregate-oriented repositories, use-case services, and boundary translations.
- Test domain behavior and boundaries directly: Aggregate invariants, valid and invalid state transitions, Value Object validation, Domain Events as outcomes, repositories as infrastructure, translation layers, and application-service orchestration.

## Trigger rules

- When a term is ambiguous, reused across contexts, or drifting into a technical placeholder, qualify, split, or rename it before coding further.
- When code wants to import another context's domain package, share enums across contexts, or couple through another context's database, add explicit translation instead.
- When legacy, vendor, partner, API, transport, persistence, or UI shape appears in local domain code, add an Anticorruption Layer or mapping boundary before modeling locally.
- When an Aggregate boundary changes or one transaction wants multiple Aggregates, list the immediate invariants that require it; otherwise coordinate by identity, Domain Events, policies, processes, or Application Services.
- When external code mutates Aggregate internals or reads internals to decide state changes, move the operation behind root behavior.
- When a Repository becomes generic CRUD, table-shaped, row-returning, or starts enforcing business rules, reshape it around Aggregate access and move rules back to the model.
- When an event reads like a command, exposes framework or persistence artifacts, or describes a minor property change, rename, narrow, or remove it.
- When Application Services or controllers accumulate branching business rules, move the decision into the Entity, Value Object, Aggregate, or Domain Service that owns the concept.
- When client rendering, query speed, or representation needs pressure the model shape, use projections, DTOs, use-case queries, or adapters instead of enlarging or exposing Aggregates.
- When a subdomain is simple CRUD, keep it simple; when invariants and lifecycle complexity appear, model them honestly instead of hiding them in services.

## Final checklist

- Is the Bounded Context explicit before interpreting names, modules, events, repositories, APIs, persistence, or integrations?
- Does the code use one local term per concept across tests, commands, events, repositories, services, and packages?
- Is Core Domain effort protected while supporting or CRUD areas stay simpler?
- Are context relationships, translation responsibilities, and upstream/downstream pressures visible?
- Are Aggregates small, root-protected, invariant-driven, identity-linked, and usually one per transaction?
- Are Entities behavior-bearing and Value Objects immutable, validated, and value-equal?
- Are Repositories Aggregate-root access points rather than generic DAOs or ORM leaks?
- Are Domain Events meaningful past-tense facts, and is Event Sourcing used only when event history is the right persistence model?
- Are Application Services coordinating use cases instead of owning domain decisions?
- Are client, foreign, persistence, and infrastructure representations kept outside the local domain model?


---

## Patterns of Enterprise Application Architecture

- **Author**: Martin Fowler
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (404 lines / 15 KB) | Mini (54 lines / 7 KB) | Nano (35 lines / 2 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Patterns of Enterprise Application Architecture by Martin Fowler

## When to use

Use as a compact always-on compass for enterprise application pattern choices.

## Primary bias to correct

Pattern reuse is not pattern choice. Make responsibilities, persistence, transactions, and remote boundaries explicit before naming a pattern.

## Decision rules

- Keep presentation/transport, application workflow, domain logic, data source interaction, transaction management, concurrency control, and integration boundaries logically separate.
- Choose the business logic pattern by complexity: Transaction Script for simple independent flows, Table Module for table-centered set logic, and Domain Model for rich behavior, invariants, identity, or lifecycle.
- Use Service Layer for use-case coordination and transaction orchestration without turning it into the default home for all domain behavior.
- Match persistence to coupling pressure: Repository/Data Mapper for domain separation, Gateway for record or table access, and Active Record only for simple persistence-coupled domains.
- Make Unit of Work, Identity Map, Lazy Load, transaction boundaries, and lock semantics visible before trusting ORM behavior.
- Keep presentation, DTOs, integration messages, vendor payloads, and serialization code free of business behavior.
- Treat remote boundaries as expensive and failure-prone: use coarse Remote Facade operations, DTO translation, explicit versioning, and partial-failure handling.
- Use session-state and base patterns only for concrete pressure; avoid fake layers, generic repositories, ORM-driven design, controller-centric workflows, and distributed-object illusions.

## Trigger rules

- If one class or layer owns UI, workflow, domain rules, SQL, transactions, and external calls, split responsibility before adding more patterns.
- If a simple Transaction Script grows duplication, invariants, or lifecycle decisions, revisit Domain Model and persistence pattern together.
- If repositories are table-shaped CRUD, models mirror tables in behavior-rich areas, or services only forward calls, check whether the database or ORM has captured the design.
- If lazy loading, duplicate identities, hidden writes, N+1 behavior, ad hoc saves, or unclear locks appear, define identity scope, Unit of Work, loading, and concurrency semantics explicitly.
- If a remote API is chatty, object-shaped, or leaks domain internals, redesign it as a coarse use-case boundary with DTO translation.

## Final checklist

- Right business logic and persistence pattern for actual complexity?
- Explicit layer, transaction, identity, loading, lock, session, and integration ownership?
- Business rules kept out of UI, DTOs, integration, and serialization?
- Remote boundary coarse, translated, version-aware, and failure-aware?


### Mini Rules Specification

# OBEY Patterns of Enterprise Application Architecture by Martin Fowler

## When to use

Use when designing or reviewing enterprise application code that crosses presentation, application workflow, domain logic, persistence, transactions, concurrency, integration, session state, or remote boundaries.

## Primary bias to correct

Enterprise applications are not improved by inventing architecture for every feature or by letting the framework, ORM, database schema, or transport shape choose the design. Use a small set of well-understood patterns to make responsibilities and boundaries explicit.

## Decision rules

- Make responsibility ownership explicit before naming patterns: presentation and transport, application workflow, domain logic, data source interaction, transaction management, concurrency control, and integration boundaries must not collapse into one class or layer.
- Use layering as the default organizing principle, but every layer must earn its cost by reducing coupling or clarifying responsibility; forbid lower layers from reaching into presentation concerns and reject pass-through layering theater.
- Choose the business logic pattern by force: Transaction Script for short independent simple flows, Table Module for table-centered set logic, and Domain Model for significant rules, invariants, identity, lifecycle, or collaboration.
- Let Transaction Scripts stay use-case focused, Table Modules stay honestly tabular, and Domain Models own rich behavior; escalate when duplication, lifecycle, or invariant complexity grows.
- Use a Service Layer to define application operations, coordinate use cases, own transaction boundaries and orchestration, expose an application-oriented API, and avoid absorbing all domain logic by default.
- At remote or cross-layer boundaries, use Remote Facade and DTOs to make coarse operations, batching, translation, and transport shape explicit; DTOs are transport structures, not domain models.
- Choose persistence patterns deliberately: repositories speak domain terms and hide query/mapping/storage details, Data Mappers keep SQL and record formats outside domain objects, gateways centralize record/table access, and Active Record is only for simple domains where persistence coupling is acceptable.
- Keep identity, write coordination, and loading behavior visible: use Identity Map for one object per identity per scope, Unit of Work for one logical transactional commit, and Lazy Load only where hidden database or remote chatter will not surprise loops or serializers.
- Choose object-relational mappings by identity, lifecycle, query needs, schema shape, and evolution cost; keep identity fields, foreign keys, association tables, dependent objects, embedded values, serialized values, inheritance mapping, metadata mapping, and query objects explicit rather than accidental.
- Design concurrency and transactions in the application workflow: optimistic locks detect conflicts and surface merge semantics, pessimistic locks require justified contention, transactions stay short, remote calls usually sit outside transactions, and helpers must not hide transaction ownership.
- Use coarse-grained and implicit offline locks only when they preserve a user-level edit without making ownership, contention, or stale-lock cleanup impossible to diagnose.
- Keep presentation code focused on input, rendering, routing, formatting, pagination, UI state, and transport; business rules stay out of controllers, views, templates, and presentation models.
- Access external systems through boundaries, translate partner formats into internal concepts, treat integration events and messages as boundary data, and do not let vendor payloads or serialization code shape internal domain design.
- Choose session state deliberately: client, server, or database session storage must account for integrity, security, scaling, cleanup, durability, server-farm sharing, and database load.
- Use base patterns only for concrete pressure: Gateway for external resources, Mapper for independent sides, Layer Supertype for real shared behavior, Separated Interface for dependency breaks, Registry for controlled well-known objects, Value Object and Money for value semantics, Special Case for repeated null/default behavior, Plugin for runtime extension, Service Stub for remote-service tests, and Record Set when tabular interchange is natural.
- Do not distribute objects or services by default; when distribution is required, separate local object design from the remote contract and budget latency, serialization, versioning, and partial failure.
- Generate code in this order: choose the business logic pattern, place use-case coordination in application services, put rich domain decisions in the domain model, hide persistence behind repositories/mappers/gateways, define transactions explicitly, put DTOs or facades only at boundaries, and keep presentation/transport at the edge.
- Test each responsibility at the level where it owns behavior: domain logic apart from UI and persistence, repositories/mappers/gateways as data infrastructure, services for workflow and transactions, locking where concurrency matters, and DTO/facade mapping at boundaries.

## Trigger rules

- If domain behavior appears in controllers, views, handlers, SQL scripts, triggers, DTOs, framework glue, serialization code, or vendor payload adapters, move it to the owning layer or justify the exception explicitly.
- If one class or layer coordinates rendering, validation, SQL, transactions, domain rules, and external calls, split by responsibility before adding another pattern.
- If a Transaction Script accumulates duplicated decisions, invariants, or lifecycle rules, revisit Domain Model and the supporting persistence pattern.
- If a model is table-shaped in a behavior-rich domain, a repository is generic CRUD, or a service only forwards to persistence, check whether the ORM or database schema has taken over the design.
- If SQL, mapping, transaction ownership, lock acquisition, saves, or external resource access is scattered across callers, introduce the smallest repository, mapper, gateway, Unit of Work, service boundary, or policy that centralizes the rule.
- If lazy loading, duplicate in-memory identities, hidden auto-persistence, N+1 behavior, or ad hoc saves can happen inside one logical work scope, define identity scope, Unit of Work, and loading behavior before continuing.
- If concurrency conflicts, stale locks, user-level edits, or long-running workflows matter, choose explicit optimistic, pessimistic, coarse-grained, or implicit locking semantics instead of relying on informal developer discipline.
- If a remote API looks like local object collaboration, leaks domain internals, or requires many calls per user action, redesign it as a coarse use-case contract with DTO translation.
- If session state has unclear owner, lifetime, storage location, security, scaling, failover, durability, or cleanup behavior, choose the session-state pattern before adding features.
- If a layer exists only to forward calls, a generic repository covers everything, an ORM model doubles as aggregate/service/DTO, or a controller owns the enterprise workflow, treat it as a forbidden-pattern review blocker.

## Final checklist

- Are presentation, workflow, domain, persistence, transaction, concurrency, integration, session, and distribution responsibilities separated intentionally?
- Does the business logic pattern match actual complexity rather than habit or framework shape?
- Are repositories, mappers, gateways, Active Record, Unit of Work, Identity Map, and Lazy Load used only where their forces fit?
- Is transaction ownership explicit, short, and kept out of hidden helpers or remote-call spans?
- Are concurrency conflicts, offline locks, identity scope, and loading behavior visible?
- Are remote and integration boundaries coarse, translated, version-aware, and failure-aware?
- Is session state owned, protected, scalable, durable enough, and cleaned up?
- Are tests aligned to the responsibility that owns each behavior?


---

## Refactoring (2nd Edition)

- **Author**: Martin Fowler
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (433 lines / 17 KB) | Mini (49 lines / 5 KB) | Nano (37 lines / 1 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Refactoring by Martin Fowler

## When to use

Use as a compact always-on rule set for changing existing code under tight context.

## Primary bias to correct

Cleanup must preserve behavior and move in small verified steps, not become a rewrite.

## Decision rules

- Preserve observable behavior; isolate feature changes, migrations, redesign, and cleanup.
- Work in small buildable, testable, reviewable steps; split changes that are too large to reason about locally.
- Get a safety net or record the verification gap before risky structural edits.
- Refactor the smell that blocks the current change, not every smell nearby.
- Prefer simple named moves: rename, extract, inline, move, split phases, encapsulate mutation, decompose conditionals, and remove duplication.
- Put behavior, state, and validation with the concept that owns them; avoid vague utilities, pass-through layers, and just-in-case abstractions.
- Keep mutation and call contracts clear: avoid boolean flags, parameter reassignment, public mutable data, unnecessary setters, and hidden side effects.
- Stop when the change is easy, the code is clearer, and further cleanup would be speculative.

## Trigger rules

- When behavior is unclear or tests are weak, characterize current behavior before broader refactoring.
- When adding a feature is awkward, make the smallest preparatory refactor that makes it straightforward.
- When the same edit appears for a third time, centralize ownership instead of copying again.
- When conditionals or type codes grow, decompose intent before reaching for polymorphism, state, strategy, or lookup tables.
- When a patch mixes cleanup with behavior or broad code motion, split it where practical.
- When tempted to rewrite, choose the next small behavior-preserving transformation.

## Final checklist

- Same behavior?
- Safety net or verification gap?
- Small runnable step?
- Clearer names, ownership, and control flow?
- No speculative abstraction or mixed patch?


### Mini Rules Specification

# OBEY Refactoring by Martin Fowler

## When to use

Use when changing existing code, preparing a feature or bug fix, reviewing cleanup, or reducing structural friction without intending to change observable behavior.

## Primary bias to correct

Refactoring is behavior-preserving design work in small steps. Do not turn cleanup into a rewrite, a hidden feature change, or speculative architecture.

## Decision rules

- Preserve observable behavior during refactoring. Isolate behavior changes from structural changes and never disguise a feature, migration, or redesign as cleanup.
- Work in small, reversible, buildable, testable, reviewable steps. Split a patch when it is too large to reason about locally.
- Establish or identify a safety net before risky refactoring. Use characterization tests for unclear behavior, keep test updates aligned with intended behavior, and never delete a failing test to finish cleanup.
- Use preparatory and follow-up refactoring around feature work: identify what makes the requested change awkward, reshape that local structure first when useful, make the behavior change, then clean debt introduced by the change.
- Refactor the current blocking smell, not every smell in sight: duplication, long functions, long parameter lists, globals, divergent change, shotgun surgery, feature envy, primitive obsession, repeated conditionals, temporary fields, middle men, or speculative generality.
- Prefer the simplest named move that helps: rename, extract, inline, move, split meanings, introduce a parameter or value object, encapsulate a field or collection, decompose conditionals, use guard clauses, or substitute a clearer algorithm.
- Make names and functions reveal intent. Rename before deeper work when bad names block understanding; keep functions coherent, at one abstraction level, with tight variable scope and separated phases.
- Put behavior and state with the concept that owns them. Split classes or modules with multiple reasons to change; separate business policy from formatting, transport, persistence, I/O, frameworks, and integration details.
- Keep data, mutation, and call contracts explicit. Avoid behavior-switching boolean flags, confusing argument order, parameter reassignment, exposed mutable collections, unnecessary setters, public fields, and duplicated state-transition logic.
- Simplify conditionals honestly. Use guard clauses, extracted predicates, lookup tables, consolidated duplicate fragments, state, strategy, polymorphism, or null objects only when they reduce repeated branching or clarify variation.
- Use abstraction and generalization only when current evidence justifies them. Remove pass-through layers, vague utilities, middle men, unused hierarchy, and just-in-case interfaces that do not improve changeability.
- Preserve error semantics unless intentionally changing behavior. Refactor error handling to reveal the main path and consolidate duplicate validation, cleanup, recovery, or error structures.
- Keep patch intent reviewable. Group related refactorings, separate structural edits from behavior where practical, and avoid giant patches that rename, move, redesign, and change logic together.
- Stop when the requested change is easy, the blocking smell is gone, readability and local changeability are clearly better, and the next cleanup would be speculative.

## Trigger rules

- When adding behavior, first ask what structural friction blocks the change; refactor before the feature only when it makes the feature safer or simpler.
- When fixing a bug in unclear code, characterize the current failure and refactor only enough to make the fix visible before changing behavior.
- When tests are absent or weak, make the smallest possible structural move and improve testability before attempting broader cleanup.
- When the same edit appears for a third time, remove duplication through clearer ownership instead of copying again.
- When a function mixes responsibilities, abstraction levels, phases, or hidden side effects, rename, extract, split phases, or isolate side effects before adding more logic.
- When one change forces edits across many files, centralize the knowledge or introduce a clearer boundary.
- When repeated conditionals or type codes grow, decompose intent first; introduce polymorphism, state, strategy, or a table only when the variation is real.
- When UI and domain behavior mix, move rules toward domain objects and verify any required presentation synchronization.
- When a patch mixes intents or code motion makes review hard, split the change unless context makes that impractical.
- When tempted to rewrite, choose the next small behavior-preserving transformation that recovers control.

## Final checklist

- Observable behavior preserved?
- Structural change, behavior change, and test updates separated where practical?
- Safety net, characterization, or verification gap recorded?
- At least one real source of friction removed?
- Names, responsibilities, control flow, data ownership, and interfaces clearer?
- Patch still reviewable and runnable?
- Cleanup stopped before speculative abstraction or rewrite pressure took over?


---

## Refactoring.Guru Design Patterns & Smells

- **Author**: Alexander Shvets
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (765 lines / 61 KB) | Mini (64 lines / 6 KB) | Nano (41 lines / 2 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Refactoring.Guru

## When to use

Use as a compact always-on bias for safe, smell-driven refactoring during existing-code changes.

## Primary bias to correct

Refactoring is not cleanup for its own sake: diagnose one smell, treat it with the smallest behavior-preserving move, verify, then stop.

## Decision rules

- Separate structural refactoring from feature and bug behavior; if behavior changes, name and isolate it.
- Diagnose the smell before choosing a technique: symptom, cost, smallest treatment, verification, and stop condition.
- Prefer small named transformations over broad redesign.
- Keep the program runnable and run relevant checks after risky movement, state-flow changes, public API changes, or algorithm replacement.
- Stop when the diagnosed smell is reduced; do not chase new smells unless they block the current change.
- Prefer extraction, naming, movement, inlining, and encapsulation before adding hierarchy, polymorphism, wrappers, or method objects.
- Do not create abstractions from coincidental similarity, random parameter bags, simple conditionals, or speculative future needs.
- Keep behavior with the data it changes unless separation intentionally supports interchangeable behavior.
- Preserve public compatibility when changing signatures, constructors, visibility, hierarchy, or externally reachable code.
- Delete or inline dispensable code only after checking public, generated, reflected, serialized, plugin-facing, framework, and test-only uses.

## Trigger rules

- When a method needs comments or local-state reconstruction, extract a named method after checking inputs, outputs, and mutated variables.
- When a class changes for unrelated reasons, extract the responsibility; use subclass/interface only for stable variants or real client subsets.
- When conditionals repeat by type or state, isolate the decision before using polymorphism; leave simple honest conditionals alone.
- When duplicate code appears the third time, refactor unless the similarity is likely to diverge.
- When parameter lists or primitive clumps carry one concept, model the concept; do not pass a huge object to hide dependency.
- When clients navigate chains or internals, hide the delegate or move behavior; remove pass-through middle men that add no policy.
- When null, error code, assertion, value/reference, or association changes are considered, verify semantics before changing structure.

## Final checklist

- Smell named?
- Smallest treatment?
- Behavior verified?
- Stop condition reached?
- No hidden feature change?
- No speculative abstraction?


### Mini Rules Specification

# OBEY Refactoring.Guru

## When to use

Use when changing existing code where code smells, refactoring technique choice, behavior preservation, and cleanup scope control matter.

## Primary bias to correct

Refactoring is not general cleanup or pattern application. It is a small, smell-driven, behavior-preserving treatment with verification and a stop condition.

## Decision rules

- Separate refactoring from feature work and bug fixes. If behavior changes, name it as behavior change and isolate it from structural edits.
- Diagnose the smell before choosing a technique: symptom, maintenance cost, scope, expected cleaner end state, verification path, and stop condition.
- Prefer the smallest treatment that directly reduces the diagnosed smell; escalate only when the smaller technique is blocked.
- Keep the code runnable and understandable through small named transformations rather than broad redesign.
- Run relevant checks after risky moves, public interface changes, state-flow changes, or algorithm substitution.
- Stop when the named smell is gone or materially reduced; record new smells separately unless they block the current change.
- Use the Rule of Three: tolerate uncertain duplication early, but refactor the third similar occurrence unless the similarity is coincidental.
- Treat technical debt as compounding cost; pay down the debt that slows current change speed, correctness, or team understanding.
- Scan smells by category: bloaters, object-orientation abusers, change preventers, dispensables, couplers, and incomplete library gaps.
- For bloaters, prefer extraction, parameter/data modeling, and responsibility splits before creating method objects, subclasses, or interfaces.
- For switch/type-code smells, isolate the decision first; use polymorphism, subclasses, or state/strategy only when variation is stable and repeated.
- For change preventers, move behavior and data toward the owner of the changing concept so one conceptual change has one main edit site.
- For dispensables, delete or inline unused structure, but check public, generated, reflected, serialized, plugin-facing, and framework extension uses first.
- For couplers, reduce navigation and private knowledge; keep delegating layers only when they hide volatile structure, policy, or a real boundary.
- Use comments for rationale, constraints, contracts, or hard algorithms; use names, variables, methods, or assertions when comments explain unclear code.
- Keep behavior with the data it changes unless separation deliberately supports interchangeable behavior.
- Encapsulation is not finished by adding getters and setters; move behavior inward when callers are still manipulating exposed data.
- Avoid speculative abstractions: do not create wrappers, parameter objects, interfaces, superclasses, or hierarchy variants without a real concept or client.
- Preserve public compatibility or provide a transition path when changing signatures, constructors, visibility, type hierarchy, or externally reachable APIs.
- Before extraction or movement, identify inputs, outputs, mutated variables, callers, visibility, construction paths, and invariants.
- Before condition consolidation or algorithm substitution, verify side effects, ordering, truth tables, edge cases, and performance-sensitive behavior.
- Before data reorganization, decide identity, value/reference semantics, mutability, equality, lifecycle ownership, association direction, and synchronization.
- Before generalization changes, prove shared behavior is real; preserve substitutability and avoid inheriting unused behavior.
- Choose exceptions deliberately: a simple conditional, useful comment, intentional strategy separation, small extension point, or clear duplication may be better than a mechanical treatment.

## Trigger rules

- When a method needs comments, scrolling, or local-state reconstruction, try `Extract Method`; use `Replace Temp with Query`, `Introduce Parameter Object`, or `Preserve Whole Object` when locals block extraction.
- When a class has multiple reasons to change, use `Extract Class`; use subclass/interface extraction only for stable variants or real client-facing subsets.
- When primitives, arrays, magic numbers, or type codes carry meaning, model the concept only if the model adds naming, validation, behavior, or safer variation handling.
- When a parameter list grows beyond local reasoning, replace derived parameters, preserve a whole object, or introduce a parameter object only for a real recurring concept.
- When the same change requires edits across many files, move methods/fields or extract ownership so the knowledge is centralized.
- When client code navigates object chains, hide the delegate or move behavior closer to the data; do not add pure forwarding.
- When a class mostly forwards, remove the middle man unless it protects boundary policy or volatile structure.
- When a method both queries and mutates, separate query from modifier unless atomic read-modify behavior is the public contract.
- When branches repeat behavior, decompose, consolidate, or move duplicate fragments only after checking side effects and execution order.
- When null checks dominate, introduce a null object only if absence can obey the same interface; keep absence explicit when it is an error.
- When inheritance creates refused bequest or intimacy, push members down or replace inheritance with delegation.
- When deleting dead or speculative code, verify external reachability and test-only access before removal.
- When a library class is incomplete, use a foreign method for one narrow gap and a local extension only for substantial repeated gaps.
- When cleanup keeps expanding, stop at the diagnosed smell and report the next smell separately.

## Final checklist

- Is this change clearly refactoring, feature work, or bug fixing?
- Which smell was diagnosed, and what cost did it create?
- Was the smallest suitable treatment used before riskier structure?
- Did behavior stay preserved under relevant checks?
- Did the named smell become materially better?
- Did the change avoid speculative abstraction and mechanical pattern use?
- Were public compatibility, state flow, and ownership checked?
- Is any intentionally untreated smell documented rather than hidden?


---

## Release It! (2nd Edition)

- **Author**: Michael T. Nygard
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (382 lines / 13 KB) | Mini (48 lines / 6 KB) | Nano (38 lines / 2 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Release It! by Michael T. Nygard

## When to use

Use when operational survivability matters and context is tight.

## Primary bias to correct

Production failure semantics, overload behavior, isolation, recovery, and diagnosis must be designed, not discovered after release.

## Decision rules

- Assume dependencies, queues, caches, callers, timeouts, bad data, and degraded states fail slowly, partially, and for longer than expected.
- Prefer visible failure, blast-radius limits, load shedding, preserved core service, and diagnosis over happy-path elegance.
- Bound outbound calls, waits, retries, queues, pools, caches, logs, result sets, payloads, and scarce resources where finite response matters.
- Retry only when safe, bounded, and backed off or jittered; never retry permanent failures or stack retries into storms.
- Isolate failure with circuit breakers, bulkheads, fast failure, separate pools, degraded modes, and deterministic cleanup.
- Treat deployment, startup, automation, health, observability, configuration, rollback, security, and runtime state as production design.
- Validate external input and responses before trusting them; prevent bad data from poisoning caches, queues, state, or downstream systems.
- Make APIs, interconnects, caches, jobs, and operational controls explicit about failure, capacity, recovery, authorization, and stop behavior.

## Trigger rules

- When adding a remote call, wait, queue, pool, cache, job, retry, or large result path, define bounds, failure behavior, validation, and saturation signals.
- When changing startup, deployment, migration, configuration, script, or control tooling, make recovery, auditability, observability, and restartability explicit.
- When traffic can concentrate through routing, scheduling, retries, fan-out, or hostile use, add back pressure, shedding, pacing, or isolation before expensive work.
- When using production tests, game days, chaos, or disaster drills, require hypothesis, blast-radius limit, observability, stop condition, and recovery path.

## Final checklist

- Bounded?
- Retry disciplined?
- Failure isolated?
- Load controlled?
- Data validated?
- Observable?
- Recoverable?
- Stoppable?


### Mini Rules Specification

# OBEY Release It! by Michael T. Nygard

## When to use

Use for services, APIs, jobs, queues, deployment paths, control tooling, and critical flows that must survive production failures, overload, latency, bad data, hostile traffic, and operational mistakes.

## Primary bias to correct

A passing happy path is not production readiness. Design the failure semantics, demand limits, isolation, recovery path, and diagnosis surface before production defines them for you.

## Decision rules

- Assume every dependency, queue, cache, timeout, caller retry, and degraded state can fail in slow, partial, or prolonged ways; code must assume production mess instead of merely tolerating it by accident.
- Prefer designs that fail visibly, limit blast radius, shed load, preserve core service, and make diagnosis possible over designs that maximize coupling or ideal-path elegance.
- Treat deployment, operations, security, observability, rollback, build and runtime state, dependency state, and configuration validation as part of the system, not after-release chores.
- Put explicit, intentional time limits on outbound calls and waits. Do not rely on library defaults or allow infinite waits where finite response matters.
- Retry only when the operation is safe for the caller and provider; bound count and total time, use backoff or jitter, and do not retry validation errors or permanent failures.
- Isolate dependency and workload failures with circuit breakers, fast failure, bulkheads, separate resource pools, and slow-work isolation so one outage cannot consume all threads, connections, or workers.
- Design overload behavior explicitly with back pressure, finite queues, demand limits, capacity reserved for critical traffic, and load shedding of lower-value work before core functions collapse.
- Use stability patterns by failure mode: steady state for routine cleanup and bounded growth, fail fast when continuing hides unrecoverable trouble or holds scarce resources, let-it-crash only with supervision and isolation, handshaking for readiness, decoupling middleware with monitoring, and governors for expensive behavior.
- Make runtime state, external responses, automation progress, migrations, operational assumptions, and boundary data visible and validated before trusted; keep rollback or roll-forward paths for partial operational changes.
- Budget scarce resources explicitly, release them deterministically, avoid holding locks or expensive connections across slow remote calls, and stream or paginate large payloads instead of defaulting to huge in-memory batches.
- Treat external input and external responses as untrusted: validate syntax, shape, business plausibility, status, content type, and semantics; prevent malformed data from poisoning caches, queues, or downstream systems.
- Build observability into boundaries and failure points with structured context, correlation identifiers, latency, throughput, error, saturation, queue, retry, breaker, dependency, version, configuration, health, and runtime signals while avoiding secrets and retry-storm log spam.
- Make startup, health checks, migrations, one-time jobs, administrative controls, process code, and delivery tooling fail safely, auditable, authorized, observable, stoppable, and recoverable.
- Make interconnects, routing, API contracts, caches, scheduled work, and background work production-aware: avoid concentrated demand, hidden single points of failure, uncontrolled fan-out, fragile chattiness, cache dogpiles, stale data surprises, and synchronized job retries.
- Include security and hostile traffic in production readiness, and use production tests, launch checks, capacity tests, game days, chaos, or disaster simulations only with limited blast radius, observability, stop conditions, and feedback into design.

## Trigger rules

- When adding an outbound call, dependency operation, resource checkout, queue consume, or thread wait, define timeout, retry eligibility, retry bounds, fallback or degraded mode, validation, and caller-survival behavior.
- When adding a queue, buffer, resource pool, cache, log stream, background job, scheduled job, or collection-returning API, define capacity, full behavior, cleanup, miss/stampede/staleness behavior, pacing, pagination or streaming, and saturation monitoring.
- When a change touches deployment, configuration, startup, migrations, one-time jobs, scripts, or operational automation, make it idempotent or restartable where practical and give it durable state, auditability, verification, and rollback or roll-forward.
- When adding health checks, load balancing, service discovery, routing, or inter-service handshakes, ensure traffic reaches only ready components and health signals reflect real ability to serve.
- When designing API or integration contracts, make material failure modes explicit, distinguish retryable from non-retryable outcomes, prefer coarse-grained resilient interactions, and document timeout, retry, version, and compatibility expectations.
- When reviewing an incident, performance failure, or capacity issue, identify the failure chain, missing defenses, detection gaps, demand, saturation, latency distribution, queue age, dependency behavior, traffic concentration, and design changes.
- When adding administrative controls, control planes, delivery tooling, hostile-traffic handling, or chaos/disaster work, require authorization, auditability, safe defaults, clear stop mechanisms, bounded blast radius, and recovery paths.

## Final checklist

- Explicit timeouts and no infinite waits?
- Retries safe, bounded, backed off or jittered, and not duplicated across layers?
- Queues, buffers, pools, caches, logs, payloads, jobs, and result sets bounded?
- Failure isolated with breakers, bulkheads, fast failure, degradation, or load shedding?
- External input and dependency responses validated before they affect state, caches, queues, or downstream systems?
- Diagnostics cover logs, metrics, health, correlation, runtime, version, configuration, dependencies, saturation, queue depth, retries, and breaker state?
- Startup, deployment, migration, automation, and operational controls restartable, observable, authorized, auditable, and recoverable where practical?
- Interconnects, APIs, caches, scheduled work, security, and chaos tests have explicit production failure behavior?


---

## The Pragmatic Programmer (20th Anniversary)

- **Author**: David Thomas & Andrew Hunt
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (359 lines / 13 KB) | Mini (65 lines / 6 KB) | Nano (44 lines / 2 KB)

### Core Bias to Correct (Nano Essence)

# OBEY The Pragmatic Programmer by Andrew Hunt and David Thomas

## When to use

Use when you need a compact always-on engineering bias toward accountability, adaptability, and fast feedback.

## Primary bias to correct

Local code changes still have system-level consequences. Own the result beyond the edit.

## Decision rules

- Be pragmatic, not dogmatic: choose what improves real outcomes, not ceremony or shortcuts.
- Keep one authoritative source for each piece of system knowledge.
- Preserve orthogonality so unrelated concerns, business rules, views, and volatile details do not change together.
- Keep important choices reversible until evidence justifies commitment.
- Learn through thin working slices, prototypes, examples, tests, and fast feedback without fossilizing shortcuts.
- Automate repeatable work, keep it versioned, and favor inspectable text or scripts where longevity and recovery matter.
- Make assumptions, contracts, failure boundaries, diagnostics, resource ownership, cleanup, and ordering explicit.
- Treat shared mutable state, globals, ambient context, and async complexity as visible costs.
- Debug from reproduced facts and measured behavior, not coincidence or blame.
- Run relevant automatic tests before calling work done.
- Dig for real requirements behind stated solutions and current implementation details.
- Leave touched code, docs, tests, tooling, and process in a condition you can stand behind.

## Trigger rules

- When knowledge is copied, choose one owner and derive or trace the rest.
- When changes fan out widely, restore orthogonality.
- When a decision is uncertain or hard to reverse, seek feedback or make the step smaller.
- When manual steps repeat, automate and version them.
- When behavior is unexplained, generated, scaffolded, or tool-derived, inspect and prove it before relying on it.
- When errors, resources, state, locks, or ordering cross boundaries, make recovery and cleanup ownership explicit.
- When requirements sound like implementation details, restate the durable need before building.

## Final checklist

- One owner?
- Localized change?
- Reversible choice?
- Fast feedback?
- Explicit failures, state, and cleanup?
- Automated tests and rituals?
- Result worth standing behind?


### Mini Rules Specification

# OBEY The Pragmatic Programmer by Andrew Hunt and David Thomas

## When to use

Use as a general engineering operating style when the goal is accountable delivery, adaptability, fast feedback, and code that remains easy to change.

## Primary bias to correct

Do not optimize only for the local edit, requested feature, or familiar ritual. Own the outcome by reducing duplicated knowledge, keeping concerns independent, proving assumptions early, automating repeated work, and making intent clear.

## Decision rules

- Be pragmatic, not dogmatic: choose the practice, formality, quality level, and stopping point that improves real outcomes for the users, risks, and codebase.
- Own the result. Surface tradeoffs, risks, uncertainty, and avoidable design costs instead of blaming tools, framework defaults, schedule pressure, or existing style.
- Think beyond the local edit: quick fixes that multiply future maintenance cost are usually a bad bargain; leave touched areas better where the cost is low.
- Keep one authoritative representation for each piece of system knowledge. Business rules, validation, status semantics, mappings, calculations, schemas, configuration meaning, generated output, and manual process steps should derive from or trace to one owner.
- Preserve orthogonality: keep components independent, responsibilities non-overlapping, interfaces narrow, collaborator knowledge small, and policy, mechanism, data, presentation, orchestration, and computation separated.
- Keep volatile decisions reversible where practical. Do not hard-code vendors, platforms, databases, deployment environments, policies, or requirements before evidence justifies the commitment.
- Use domain vocabulary and small domain languages only when they make rules clearer to the people who must validate or change them.
- Prefer thin end-to-end tracer bullets over piles of isolated pieces. Keep the first slice simple but real enough to validate architecture, integration, and assumptions.
- Use prototypes to learn, not to pretend the work is done. State what the prototype proves, what it does not prove, and which shortcuts must be discarded or hardened.
- Dig for real requirements. Separate durable needs and constraints from current implementation details, proposed solutions, growing prose specs, and unresolved team hesitation.
- Automate repetitive, error-prone, easy-to-forget, or ritualized work. Builds, tests, linting, formatting, packaging, deployment, setup, validation, and release should be reproducible and aligned with shared automation.
- Shorten feedback loops with relevant tests, automated checks, visible failures, and cheap early signals before late expensive surprises.
- Make contracts, assumptions, invariants, responsibilities, and caller/callee obligations explicit and close to the abstraction they protect.
- Distinguish programmer errors, contract violations, impossible states, expected domain failures, retryable failures, recoverable failures, and permanent failures; preserve diagnostic context and fail inside boundaries that prevent wider collapse.
- Treat resource ownership as a contract. Release every acquired allocation, handle, lock, or resource on success and failure paths, preferably opposite acquisition order.
- Prefer inspectable plain text, open formats, scripts, explicit serialization, and version-aware configuration when longevity, diffability, automation, migration, or interoperability matter.
- Treat shared mutable state, ambient context, globals, temporal coupling, and asynchronous complexity as costs that must earn themselves and be made visible.
- Use tooling as leverage for correctness and speed, but understand generated code, formal methods, specifications, and tool output before relying on them.
- Debug from reproduced facts: observe, isolate, explain, fix, and verify before guessing or blaming compilers, operating systems, libraries, or vendors.
- Break work into small deliverable increments with honest uncertainty, visible risk, and estimates that can be corrected by feedback.
- Communicate through code, names, docs, comments, commit messages, scripts, tests, and artifacts. Use comments for rationale, contracts, or non-obvious behavior, not as substitutes for encoded rules.
- Build pragmatic teams around shared responsibility, explicit expectations, automation, fast feedback, visible quality, and artifacts you are willing to stand behind.
- Apply the broken windows rule: fix or visibly contain small quality decay before bad code, unclear ownership, weak design, or broken process becomes normal.

## Trigger rules

- When the same fact appears in multiple artifacts, choose one owner and derive, generate, validate, or trace the rest.
- When one change requires edits in many unrelated places, repair the missing boundary or hidden coupling before it spreads.
- When volatile details are hard-coded, move them into validated, controlled, versioned configuration, metadata, or an explicit abstraction.
- When uncertainty is high or a decision is hard to reverse, reduce risk with tracer feedback, a prototype, a smaller reversible step, or a delayed commitment.
- When prototype code, generated scaffolds, diagrams, specs, formal models, or tool output start becoming production truth, inspect, understand, harden, replace, or reject them deliberately.
- When prose specifications keep growing without reducing uncertainty, build a working slice, example, or prototype that forces feedback.
- When hidden assumptions live only in comments, caller folklore, or tribal setup steps, move them into code, contracts, tests, scripts, or checked configuration.
- When an error or resource crosses a boundary, decide who can recover, what context survives, and who owns cleanup.
- When shared state, async behavior, locks, ordering, or temporal coupling appears, make ownership, synchronization, cleanup, and ordering requirements explicit.
- When repeated manual steps, human checks, environment rituals, or release procedures appear, automate and version them.
- When tests are slow, flaky, environment-dependent, or require excessive unrelated setup, improve the feedback path rather than normalizing skipped checks.
- When a human finds a bug, add or improve an automatic regression test around the protected contract.
- When code works for reasons nobody can explain, stop and prove the behavior with data before depending on it.
- When local decay appears in touched code, fix it if cheap or leave an explicit containment or cleanup path.

## Final checklist

- One authoritative owner for each system fact?
- Unrelated concerns independent and volatile choices reversible?
- Working feedback exists for risky assumptions?
- Prototype, generated, and tool-derived behavior deliberately accepted?
- Contracts, failures, diagnostics, resources, and cleanup explicit?
- State, concurrency, ordering, and coupling visible?
- Repeatable work automated, versioned, and aligned with shared checks?
- Tests automatic, relevant, and run before calling the change done?
- Names, comments, docs, scripts, tests, and commits communicate intent?
- Touched area better or explicitly contained?


---

## Working Effectively with Legacy Code

- **Author**: Michael Feathers
- **Repository Path**: 
- **Rule Counts & Sizes**: Full (371 lines / 13 KB) | Mini (50 lines / 5 KB) | Nano (35 lines / 1 KB)

### Core Bias to Correct (Nano Essence)

# OBEY Working Effectively with Legacy Code by Michael Feathers

## When to use

Use when changing poorly tested or poorly understood code under a tight context budget.

## Primary bias to correct

Legacy work starts with control, not cleanup, rewrite, or elegance.

## Decision rules

- Treat code without trustworthy tests as legacy code: state what changes and what must remain.
- Characterize uncertain current behavior before changing it, including ugly behavior consumers may rely on.
- Use the legacy loop: find the change point, find an observation point, create or exploit a seam, break the blocking dependency, test, change, then refactor locally.
- Prefer fast focused tests; use broader harnesses only as temporary first coverage when no narrow test point exists.
- Create the narrowest useful seam for sensing or separation, and break only dependencies that block feedback.
- Use sprout, wrap, parameterize, inject, extract, or override moves when direct edits would be unsafe.
- Keep behavior changes, structural refactorings, and cleanup separate and small.
- Do not leave test-only seams, hidden dependencies, wrappers, globals, subclass tricks, or link/preprocessor tricks without a cleanup plan.

## Trigger rules

- When behavior is unclear, characterize first.
- When constructors, globals, statics, frameworks, I/O, clocks, randomness, environment, or deep object graphs block testing, break one dependency at the narrowest point.
- When a large method or class defeats local reasoning, sketch effects and create a seam before semantic edits.
- When rewrite or broad cleanup feels tempting, choose the next smaller verified move.

## Final checklist

- Behavior characterized?
- Feedback fast enough?
- Dependency isolated?
- One kind of change?
- Safer and clearer now?


### Mini Rules Specification

# OBEY Working Effectively with Legacy Code by Michael Feathers

## When to use

Use when changing code that is expensive to change safely because behavior is unclear, tests are weak or missing, dependencies are hidden, or runtime/framework setup blocks local feedback.

## Primary bias to correct

Gain control before improving design. Understand current behavior, protect what must stay, create the smallest useful seam, break the dependency that blocks feedback, make the requested change, then leave the area more testable.

## Decision rules

- Treat any area without trustworthy tests as legacy code; do not start with rewrite or module-wide cleanup unless that is explicitly required or clearly safer.
- Before editing, state the requested behavior change and the current behavior that must remain; characterize uncertain or suspicious behavior instead of silently fixing it.
- Follow the legacy loop: identify the change point, check existing protection, add characterization where possible, find or create a seam, break the blocking dependency, change behavior, then refactor locally.
- Prefer fast, focused tests around the slice being changed; use broader interception or integration tests only when they are the safest first observation point.
- Choose test points by tracing effects outward from the change point through values, calls, fields, outputs, collaborators, interception points, and pinch points.
- Use the smallest seam that allows substitution, observation, or interception; make clear whether the seam is for sensing, separation, or both.
- Break dependencies deliberately: expose hidden inputs, hard outputs, hard construction, globals, statics, ambient context, and framework callbacks only where they block testing or safe change.
- Keep behavior changes, structural refactorings, and cleanup separate; verify small steps and avoid checking in exploratory restructuring used only for understanding.
- When direct edits are risky, add behavior with sprout method, sprout class, wrap method, wrap class, or extract-and-override style moves, then fold the temporary structure into better design when tests support it.
- For hard-to-test methods, split construction from use, extract side effects behind collaborators, carve pure computation first, and isolate policy from runtime, persistence, UI, or framework mechanisms.
- Use dependency-breaking techniques according to the actual barrier: adapt narrow parameters, extract interfaces or implementers, parameterize constructors or methods, encapsulate globals, introduce instance delegators, override factories/calls, or use link/preprocessing seams only when ordinary object seams are impractical.
- In large code, sketch effects and group responsibilities before moving behavior; let excessive setup, impossible observation, and repeated changes point to smaller extracted responsibilities.
- During review, treat no tests around modified logic, mixed structural and behavioral edits, broad edits in poorly understood modules, hard-coded collaborators, global/static reach-through, constructor side effects, and business logic trapped in framework entry points as legacy-change risks.
- Reject changes that expand hidden dependencies, mock around untestable structure without improving it, rename or format while leaving the real dependency knots intact, or introduce large architecture before basic seams exist.
- Leave the touched area easier to understand, test, or change; do not mistake test-only seams, wrappers, subclass tricks, or build tricks for design improvement by themselves.

## Trigger rules

- When behavior is uncertain, consumers may rely on ugly behavior, or a branch/path is hard to prove, add characterization or another explicit observation path before changing semantics.
- When tests require too much setup or a class cannot be instantiated cheaply, break the first real barrier: constructor work, hidden allocation, factory call, global state, static construction, framework object, or hard parameter.
- When time, randomness, environment, thread-local state, current user/request, files, network, process exits, database writes, messages, or control-flow logging block repeatable tests, wrap or inject that boundary.
- When a large method or class defeats local reasoning, sketch effects, find interception or pinch points, extract pure computation first, and avoid editing many branches at once.
- When changing database-heavy, UI, framework, or API-boundary code, separate policy from query/mapping/persistence, handlers/callbacks, adapters, and runtime setup; keep real-boundary integration tests where they matter.
- When a seam is magical, temporary, public-for-test, subclass-only, link/preprocessor-based, or probe/sensing-variable-based, add a cleanup obligation and remove it once safer structure exists.
- When repeated edits cluster across several places, remove duplication incrementally under tests instead of launching a broad redesign.
- When rewrite or heroic cleanup feels tempting, choose the smallest sprout, wrap, seam, characterization, or refactoring step that makes today's requested change safer.

## Final checklist

- Untested or weakly tested area treated as legacy risk?
- Behavior delta and behavior-to-preserve stated?
- Uncertain current behavior characterized or explicitly observed?
- Tests close enough and fast enough to diagnose the change?
- Smallest useful seam chosen, with sensing vs separation clear?
- Blocking dependency reduced without expanding hidden dependencies?
- Behavior change, refactoring, and cleanup kept separate?
- Temporary seam or dependency-breaking trick has a cleanup path?
- Touched area is more understandable, testable, or changeable?


---

