# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-09-12

### Added
- **Stateless Advisory Tool Discovery (ADR 0003 / Issue #19)**: Tools are no longer blocked prior to search (`assertAuthorized` is now a no-op). All registered and catalog tools can be executed directly from Turn 0.
- **Reactive Failure Guidance**: When a tool execution fails (runtime error or validation failure), the engine enriches the error payload with an advisory `[Tool Hint]` pointing the model to `tool_search_regex` for detailed guidelines.
- **Subagent Manifest Fallback**: If a session lacks `tool_search_regex` in its active manifest (e.g. subagents), the reactive hint falls back to parameter schema review guidance without suggesting unavailable tools.
- **DeliveryHistory LRU Capacity**: Bound in-memory delivery suppression cache to 256 sessions with LRU eviction and lifecycle cleanup on `session.deleted`.

### Changed
- **Advisory System Prompt & Tool Descriptions**: Policy text and search tool descriptions updated to remove all "required before use" and "unlock" phrasing, explicitly declaring that tools can be executed directly if parameters are understood.
- **Clean Reset Tool Execution**: Reset tools (e.g. `compress`) silently clear delivery history without injecting synthetic notice banners into tool outputs.
- **Preserved Prompt Token Virtualization**: Non-essential tool descriptions remain truncated with `[deferred]` in manifests, retaining 100% upfront token savings while keeping JSON parameter schemas intact.

### Removed
- **Decommissioned Ephemeral Authorization State**: Completely removed `AuthorizationState` and disk-based `AuthPersistence` (`authorizations.json`), eliminating split-brain state, session fork amnesia, and compaction deadlocks.
- **Removed Presence-Regex Scraping**: Removed fragile message text scraping and speculative tool revocations in `syncSleevCompression` and `syncActiveAuthorizations`.
