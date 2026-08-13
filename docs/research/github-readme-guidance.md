# How to Write a Good GitHub README — Primary-Source Guidance

**Date:** 2026-08-10
**Scope:** Research only (no README or source changes). Guidance for a TypeScript plugin/library (`@openstellar/tool-search`), drawn exclusively from primary/high-trust sources: GitHub's official documentation, GitHub's official Open Source Guides, the GitHub ReadME Project, and the well-established Standard Readme / Best-README-Template community specs.

**Source catalog (all fetched 2026-08-10, content indexed):**

| # | Source | Type | URL |
|---|--------|------|-----|
| S1 | GitHub Docs — About READMEs | Official | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes |
| S2 | GitHub Docs — Quickstart for writing on GitHub | Official | https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/quickstart-for-writing-on-github |
| S3 | GitHub Docs — Basic writing and formatting syntax | Official | https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax |
| S4 | GitHub Docs — Setting guidelines for repository contributors | Official | https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors |
| S5 | GitHub Open Source Guides — Starting an Open Source Project | Official (GitHub) | https://opensource.guide/starting-a-project/ |
| S6 | GitHub Open Source Guides — The Legal Side of Open Source | Official (GitHub) | https://opensource.guide/legal/ |
| S7 | Standard Readme — spec.md | Community spec (widely adopted) | https://raw.githubusercontent.com/RichardLitt/standard-readme/main/spec.md (repo: https://github.com/RichardLitt/standard-readme) |
| S8 | Best-README-Template (othneildrew) | Community template (well-established) | https://github.com/othneildrew/Best-README-Template |
| S9 | GitHub ReadME Project — Guides index & "Document your accomplishments" | Official (GitHub editorial) | https://github.com/readme/guides · https://github.com/readme/guides/document-success |

> The `standard-readme.org` domain (Docker/legacy landing) did not resolve on fetch day; the canonical spec lives in the GitHub repo `RichardLitt/standard-readme` (S7), which was fetched successfully. The legacy `opensource.guide/starting-an-open-source-project/` URL now 404s; the maintained path is `opensource.guide/starting-a-project/` (S5).

---

## 1. Executive findings

1. **The README is the front door and the contract.** GitHub's official docs say a README "tell[s] other people **why your project is useful**, **what they can do with your project**, and **how they can use it**" (S1), and that it is "often the first item a visitor will see" (S1). It is also the first thing the Open Source Guides' pre-launch checklist requires: a LICENSE file, "basic documentation (README, CONTRIBUTING, CODE_OF_CONDUCT)", an easy name, and a clean issue queue (S5).
2. **Placement and discovery rules are explicit.** READMEs in `.github`, repo root, or `docs/` are auto-surfaced; the root wins over `docs/`, and `.github` wins over root (S1). Content beyond **500 KiB is truncated** when viewed on GitHub (S1) — a hard size ceiling for the whole file.
3. **The sections themselves are not a matter of taste — there are two authoritative, codified structures.** Standard Readme (S7) defines a strict README spec with required sections (`Background`, `Install`, `Usage`, `API`, `Contributing`, `License`), a required Table of Contents, and required code blocks (install + usage). Best-README-Template (S8) is the other widely-followed template (`About the Project / Getting Started / Usage / Roadmap / Contributing / License / Contact / Acknowledgments`).
4. **A library README must show, not just tell.** Standard Readme requires: an install code block; a common-usage code block; and, for importable libraries, "a code block indicating both import functionality and usage" (S7). For a TypeScript plugin this means: `npm install` / `pnpm add`, a `import { … } from '…'` example, and a minimal working configuration snippet — all syntax-highlighted fenced code blocks (S3).
5. **License is non-negotiable and belongs last.** "You **must** include a license when you launch an open source project" (S5); without one, contributions are exclusively owned by their authors and nobody can legally use the code (S6). Standard Readme requires the License section to state the **SPDX identifier** and the license **owner**, and to be the **last** section (S7).
6. **Contributing is a discoverable, separate concern.** A `CONTRIBUTING.md` (root, `docs/`, or `.github/`) is surfaced by GitHub in a "Contributing" tab, the sidebar, the contribute page, and to anyone opening an issue/PR (S4). The README should link to it rather than duplicate it (S7 "Suggestions").
7. **Length and noise discipline are explicit official requirements.** GitHub truncates READMEs past 500 KiB (S1); Standard Readme warns against too many badges, recommending them near the top and only a few (S7 repo README); and the Open Source Guides tie *writing tone* — warm, inclusive, simple language — to project brand and newcomer retention (S5).
8. **Anchors/links are mechanical and testable.** GitHub auto-generates section anchors with documented rules (lowercase, spaces→hyphens, punctuation stripped, dedup via `-1`, `-2` …) (S3), which makes the Table of Contents and intra-README links predictable and verifiable.
9. **Nothing in any primary source asks for secrets in a README.** The Open Source Guides' pre-launch checklist instead requires the opposite: "no sensitive materials in the revision history, issues, or pull requests (for example, passwords or other non-public information)" (S5).

---

## 2. Official purpose and placement (S1, S5)

### 2.1 What the README is for (S1)

> "You can add a README file to your repository to tell other people why your project is useful, what they can do with your project, and how they can use it."

> "A README is often the first item a visitor will see when visiting your repository. README files typically include information on:
> - What the project does
> - Why the project is useful
> - How users can get started with the project
> - Where users can get help with your project
> - Who maintains and contributes to the project"

(S1, "About READMEs" section)

The README is also positioned as one pillar of a healthy-repository set: "A README, along with a repository license, citation file, contribution guidelines, and a code of conduct, communicates expectations for your project and helps you manage contributions" (S1).

### 2.2 Where it must live (S1)

- Recognized locations: hidden `.github`, repository **root**, or `docs` directory — GitHub auto-surfaces the README from any of them.
- Collision order when multiple exist: `.github` → root → `docs`.
- Hard limit: "any content beyond **500 KiB** will be truncated" when viewed on GitHub.

### 2.3 Tone and brand (S5)

> "Throughout the life of your project, you'll do a lot of writing: READMEs, tutorials, community documents… your writing style is part of your project's brand."

> "Using warm, inclusive language… can go a long way in making your project feel welcoming to new contributors. Stick to simple language, as many of your readers may not be native English speakers."

(S5, "Naming and branding your project" — "How you write (and code) affects your brand, too!")

---

## 3. The two codified structures

### 3.1 Standard Readme spec (S7) — designed for open source libraries

From `spec.md`: "Standard Readme is designed for open source libraries… it also applies to libraries in other languages and package managers." (i.e., it is a library-oriented spec — the closest match for a TypeScript plugin.)

Required file shape:
- Filename **README** (with capitalization) and a supported extension (e.g. `README.md`).
- A **Table of Contents** that links to **all** sections, starts with the first section (no title or ToC heading inside it), and is at least one level deep capturing every `##` heading.
- Required sections in order:
  1. **Background** — explains motivation ("why").
  2. **Install** — **required:** "Code block illustrating how to install."
  3. **Usage** — **required:** "Code block illustrating common usage. If CLI compatible, code block indicating common usage. If importable, code block indicating both import functionality and usage."
  4. **API** — documented API surface; may link to fuller external docs.
  5. **Contributing** — link to a CONTRIBUTING file if one exists.
  6. **License** — "State license full name or identifier, as listed on the SPDX license list. For unlicensed repositories, add `UNLICENSED`. For more details, add `SEE LICENSE IN <filename>` and link to the license file." Must state the license owner, and **must be the last section**.

Suggested (non-required) extras per the spec: link to a CONTRIBUTING file, be as friendly as possible, link to GitHub issues, link to a Code of Conduct, and welcome a contributors subsection.

(Standard Readme also defines a **Badge** section — see §4.4.)

### 3.2 Best-README-Template (S8) — the other widely-followed shape

Section order used by the template:

```
About The Project
  └─ Built With
Getting Started
  └─ Prerequisites
  └─ Installation
Usage
Roadmap
Contributing
License
Contact
Acknowledgments
```

Its opening header block also models the standard "value proposition + CTA" trio:

```
[Project Title]
[short, punchy description]
Explore the docs » · View Demo · Report Bug · Request Feature
```

### 3.3 Synthesis for a TypeScript plugin/library

The two structures agree on the core spine; for `@openstellar/tool-search` (an npm-published TypeScript plugin) the recommended shape is the Standard Readme order — the library-oriented spec — with Best-README-Template's value-prop header and `Prerequisites` pattern folded in:

```
<Title> + one-line value proposition + badges (sparse)
Table of Contents          (required by S7; links all ## headings)
Background / Why           (what problem, why it exists — S7 §3.1)
Install                    (npm/pnpm/yarn code block — required by S7)
Usage                      (import + minimal working example — required by S7)
Configuration              (options/peers — plugin-specific)
API                        (public surface; link to full docs — S7)
Compatibility              (supported hosts/engines/peer versions)
Troubleshooting            (known issues; link to issues — S7 suggestion)
Contributing               (link to CONTRIBUTING.md — S7 suggestion)
License                    (SPDX id + owner, LAST section — required by S7)
```

> 500 KiB hard ceiling (S1) and the "sparse badges" guidance (S7) together argue for keeping the README a *portal*: full API/usage detail lives in linked docs, not inline.

---

## 4. Section-by-section recommendations (with citations)

### 4.1 Opening value proposition

- Say in the first paragraph **what it does, why it's useful, and how to use it** (S1). The Best-README-Template models the compact header + `Explore the docs » / View Demo / Report Bug / Request Feature` links (S8).
- For a library, the first 3 sentences should answer: *what does this package do, who is it for, and what does it cost (install + 1-line usage)?* That is the README's stated job (S1) compressed to the fold.
- Keep it in simple, warm, inclusive language (S5, §2.3).

### 4.2 Table of contents

- **Required** by Standard Readme; must link to all sections, exclude the title and the ToC heading itself, and capture every level-two heading (S7).
- GitHub auto-generates an "Outline" ToC from headings (S1) and defines the anchor algorithm (S3, §6) — so links you write by hand are predictable and testable.

### 4.3 Install

- **Required:** "Code block illustrating how to install" (S7).
- For an npm package: one or two copy-pasteable commands in a fenced code block:
  `npm install @openstellar/tool-search` (or `pnpm add` / `yarn add` — match the ecosystem; Standard Readme itself uses `npm install --global …`, S7 repo).
- If the plugin has peer dependencies (e.g. a host runtime version), surface them here or in a Compatibility section rather than letting install fail mysteriously.

### 4.4 Badges

- Standard Readme's own guidance: "It is generally recommended to place badges near the top of your README so that important project information is immediately visible… **Avoid adding too many badges, as excessive badges can make a README look cluttered and reduce readability**" (S7 repo, "Badge" section). The Standard Readme compliance badge itself is explicitly "not required" (S7).

### 4.5 Usage / examples

- **Required:** "Code block illustrating common usage… If importable, code block indicating both import functionality and usage" (S7).
- For a TypeScript library this is non-negotiable: a fenced, syntax-highlighted code block (S3) showing `import { … } from '@openstellar/tool-search'` followed by a minimal working snippet.
- GitHub supports fenced code blocks with language hinting for syntax highlighting (S3, "Quoting code"; see also GitHub Docs "Creating and highlighting code blocks").

### 4.6 Configuration

- Not a named section in either spec, but Standard Readme's **API** section covers the config surface (S7), and its "Extra Sections" allowance covers options tables.
- For a plugin: a short options/parameters table plus one copy-pasteable config block (fenced, S3) that a user can drop in and run. Keep the *full* option reference in linked docs to respect the 500 KiB ceiling (S1).

### 4.7 Compatibility

- Not in the two specs; Best-README-Template's `Prerequisites` subsection is the closest model: "This is an example of how you may give instructions on setting up your project locally… follow these simple example steps" (S8, "Getting Started").
- For a TypeScript plugin: declared peer-dependency range, supported host/runtime versions, Node version, TypeScript version, and any engine constraints — this is exactly the "technical requirements (like tests)" the Open Source Guides tell you to state early so contributions arrive well-formed (S5; S4's rationale: guidelines "help them verify that they're submitting well-formed pull requests").

### 4.8 Troubleshooting

- Neither spec mandates it; both support it via Standard Readme's "Extra Sections" (S7) and Best-README-Template's `Roadmap`/issues links (S8).
- Minimum viable: a "known issues" pointer — Standard Readme's Contributing suggestions include "Link to the GitHub issues" (S7). A short FAQ of the top 3–5 failures (with the fix) beats a long list; the rest belongs in linked docs (500 KiB ceiling, S1).

### 4.9 Development / testing (contributor setup)

- The Open Source Guides make contributor onboarding a README-adjacent obligation: the CONTRIBUTING file should explain "how to set up your environment and run tests" (S5, "Writing your contributing guidelines").
- For this repo's shape: a short "Development" subsection — `npm install`, `npm test` (vitest), `npm run build`, lint — is exactly the "technical requirements" the guides recommend stating (S5). Deeper detail (issue templates, PR flow, CoC) belongs in `CONTRIBUTING.md`, which GitHub auto-surfaces in the Contributing tab, sidebar, and contribute page (S4).

### 4.10 Contributing

- **Required by Standard Readme** as a section; the spec's suggestion: "Link to a CONTRIBUTING file — if there is one… Be as friendly as possible. Link to the GitHub issues… Link to a Code of Conduct" (S7).
- GitHub's official docs: contributing guidelines live at root, `docs/`, or `.github/`; when a `CONTRIBUTING.md` exists GitHub shows it in the Contributing tab, the sidebar, the contribute page, and to anyone opening an issue or PR (S4). So the README's Contributing section should be a *pointer*, not a duplicate.

### 4.11 License

- **You must include a license** (S5). Without one, "nobody else can use, copy, distribute, or modify your work" and even your own contributors' code is exclusively owned by them (S6).
- Standard Readme requires: state the **SPDX license identifier** (or `UNLICENSED`), state the **license owner**, and make License the **last section** (S7). "For more details, add `SEE LICENSE IN <filename>` and link to the license file" (S7).
- Copy-paste the standard MIT / Apache-2.0 / GPLv3 text rather than writing custom terms: "Unless absolutely required, avoid custom, modified, or non-standard terms" (S6, quoting @benbalter). `choosealicense.com` is the official-cited picker (S5, S6).

---

## 5. Formatting mechanics that matter (S2, S3)

- **Headings** organize the README and feed GitHub's auto-generated Outline ToC (S1).
- **Paragraphs** are created with a blank line between lines of text (S3).
- **Inline code** with single backticks (`git status`) — "The text within the backticks will not be formatted" (S3).
- **Fenced code blocks** with triple backticks; use the language hint for syntax highlighting (S3, "Quoting code").
- **Emoji** via `:EMOJICODE:` if desired (S3, "Using emojis") — use sparingly to respect the anti-clutter guidance (S7).
- **Tables** are part of GitHub-flavored Markdown and are the right tool for option lists (S3).
- **Section links/anchors** are auto-generated from headings by a documented algorithm — lowercase, spaces→hyphens, punctuation stripped, dedup with `-1`, `-2`… (S3) — so ToC links can be written by hand with confidence.
- The Quickstart (S2) walks through heading, paragraph, link, relative-link, image, and code-block basics and is the canonical hands-on tutorial.

---

## 6. Explicitly NOT recommended / anti-patterns (primary-source backed)

1. **No license** — "You must include a license when you launch an open source project" (S5); unlicensed work is unusable and contributions revert to exclusive ownership (S6).
2. **README past 500 KiB** — truncated on GitHub (S1). Keep the README a portal; push depth into linked docs.
3. **Badge wall** — "Avoid adding too many badges" (S7).
4. **Secrets anywhere in the repository** — the official pre-launch checklist requires "no sensitive materials in the revision history, issues, or pull requests (for example, passwords or other non-public information)" (S5). Nothing in any source calls for secrets in a README; the README documents the project, never credentials.
5. **Duplicate CONTRIBUTING content inline** — GitHub auto-surfaces `CONTRIBUTING.md` (S4); link, don't copy.
6. **Custom license text** — prefer standard SPDX-identified licenses (S6, S7).
7. **Unfriendly/opaque tone** — writing style is brand; keep it warm, inclusive, simple (S5).

---

## 7. Sources (verified 2026-08-10)

All URLs fetched successfully on 2026-08-10; content indexed in the session knowledge base. The two canonical specs (S7 spec.md, S8 template) are community-established and cited as such — every other source is GitHub-official.

1. **GitHub Docs — About READMEs** — https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes — purpose (§2.1), placement/500 KiB (§2.2), auto-ToC (§4.2).
2. **GitHub Docs — Quickstart for writing on GitHub** — https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/quickstart-for-writing-on-github — hands-on Markdown tutorial (§5).
3. **GitHub Docs — Basic writing and formatting syntax** — https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax — paragraphs, fenced code, emoji, section links/anchor algorithm (§5).
4. **GitHub Docs — Setting guidelines for repository contributors** — https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors — CONTRIBUTING.md placement and discovery (§4.9–4.10).
5. **GitHub Open Source Guides — Starting an Open Source Project** — https://opensource.guide/starting-a-project/ — pre-launch checklist, license mandate, CONTRIBUTING guidance, tone/brand (§2.3, §4.9–4.10, §6).
6. **GitHub Open Source Guides — The Legal Side of Open Source** — https://opensource.guide/legal/ — why licenses matter, contributions ownership, standard licenses (§4.11, §6).
7. **Standard Readme (RichardLitt/standard-readme) — spec.md** — https://raw.githubusercontent.com/RichardLitt/standard-readme/main/spec.md (repo: https://github.com/RichardLitt/standard-readme) — library-oriented README spec: required sections, ToC rules, install/usage code blocks, SPDX license requirements, badge guidance (§3.1, §4).
8. **Best-README-Template (othneildrew)** — https://github.com/othneildrew/Best-README-Template — widely-used template: section order, value-prop header, Prerequisites, Roadmap, Acknowledgments (§3.2, §4.1).
9. **GitHub ReadME Project — Guides** — https://github.com/readme/guides · https://github.com/readme/guides/document-success — GitHub editorial hub on documentation practice (context; not cited for specific claims).

**Verification notes:**
- `docs/research/` exists in this repo and already contains three sibling research docs (`opencode-v118-tool-search-bug-research.md`, `system-prompt-efficiency.md`, `tool-search-policy-audit.md`) — this file follows that directory's convention.
- Two initially-fetched URLs failed and were replaced with the canonical ones: `opensource.guide/starting-an-open-source-project/` (404) → `opensource.guide/starting-a-project/` (S5); `standard-readme.org` (DNS failure) → `github.com/RichardLitt/standard-readme` (S7). A guessed `readme/guides/better-documentation` (404) was dropped in favor of the verified index and `document-success` guides.
- **No README.md or source files were modified**; this is a research deliverable only.
