# AGENTS.md

This repository is an Obsidian-first LLM Wiki.

The human curates sources and asks questions.
The agent maintains the wiki.

<!-- LLM_WIKI_CONTRACT_START -->

## Mission

Maintain a persistent, high-signal markdown wiki that sits between raw sources and future reasoning.

Do not answer only in chat when the result belongs in the wiki.
Prefer to turn durable work into durable markdown pages.

## Architecture

There are three layers:

1. `raw/` contains immutable source material. Never modify source contents.
2. `wiki/` contains LLM-maintained pages. The agent may create, update, rename, merge, and cross-link these pages.
3. `AGENTS.md` defines the operating rules.

## Core Rules

1. Treat `raw/` as source of truth and `wiki/` as maintained synthesis.
2. Never edit files inside `raw/` unless the user explicitly asks.
3. Prefer many small linked pages over one giant dumping-ground page.
4. Use Obsidian wikilinks like `[[concept-name]]` whenever a stable concept, entity, person, project, or source page exists.
5. Preserve uncertainty. If a claim is weak, disputed, inferred, or contradicted, say so explicitly.
6. Cite the underlying source page from any claim-heavy wiki page.
7. When answering substantial questions, save the answer into `wiki/analyses/` unless the user asks for chat-only output.
8. Keep `wiki/_meta/index.md` and `wiki/_meta/log.md` current after meaningful work.

## Folder Semantics

- `wiki/sources/`: one page per source, including source metadata, summary, key claims, and links to affected pages
- `wiki/concepts/`: concepts, frameworks, recurring ideas, terminology
- `wiki/entities/`: organizations, products, systems, places, or domain objects
- `wiki/people/`: people and roles
- `wiki/projects/`: efforts, initiatives, cases, programs, or workstreams
- `wiki/timelines/`: chronological pages
- `wiki/analyses/`: saved answers, comparison memos, synthesis notes, decision memos
- `wiki/_meta/`: dashboard, index, log, and other operational pages

## Page Creation And Promotion Thresholds

- Create or refresh a `wiki/sources/` page for an explicit source that should remain verifiable or reusable.
- Create or promote a concept, entity, person, project, or timeline page only when it is stable enough for future reuse, appears across multiple sources or canonical surfaces, or the user explicitly asks to preserve it.
- A passing mention is not enough for a standalone page. Keep it in the source page until its scope becomes durable.
- Before creating a page, search for an existing page with overlapping scope. Extend or merge the existing page instead of creating a duplicate.
- Use `wiki/analyses/` for durable comparisons, decisions, synthesized answers, plan reviews, and unresolved tradeoffs.
- A thin stub is acceptable only when the page is required as a navigation or evidence path and its missing evidence is stated explicitly.

## Page Conventions

Every wiki page should start with YAML frontmatter when practical.

Recommended fields:

```yaml
---
title: Example Page
type: concept
status: active
created: 2026-04-08
updated: 2026-04-08
tags:
  - llm-wiki
sources:
  - "[[source-2026-04-08-example]]"
---
```

Guidelines:

- `title`: human-readable page title
- `type`: one of `source`, `concept`, `entity`, `person`, `project`, `timeline`, `analysis`, `meta`
- `status`: usually `active`, `draft`, `superseded`, or `open-question`
- `sources`: wikilinks to source pages, not raw file paths
- Keep sections crisp and scannable
- Use headings instead of long uninterrupted prose

## Certified Source Ingest

For raw source-to-wiki work that needs full coverage, batch processing, or a
`ready` completion claim, invoke the installed `llm-wiki-loop` skill before
semantic mutation. That skill owns the procedure, coverage, batch, and final
review runtime; it runs from its own skill directory and records only receipts
and state under this wiki.

If the loop skill is unavailable, you may make clearly labelled draft or manual
wiki edits, but do not claim `full` coverage or `ready` ingest completion.

## Source Ingest Workflow

When the user asks to ingest a source:

1. For certified ingest, invoke `llm-wiki-loop`; otherwise state that the work
   is an uncertified draft before editing.
2. Read the raw source from `raw/inbox/`, `raw/processed/`, or `raw/notes/`.
3. Locate the matching page in `wiki/sources/`. If it does not exist, create it.
4. Write or update:
   - concise overview plus coverage-preserving section synthesis
   - key facts
   - important claims
   - contradictions or uncertainties
   - open questions
   - links to affected wiki pages
5. Update every affected concept, entity, person, project, or timeline page.
6. Create missing pages when a concept or entity clearly deserves its own page.
7. Rebuild or refresh `wiki/_meta/index.md` if page inventory changed.
8. Append an entry to `wiki/_meta/log.md`.

## Query Workflow

When the user asks a question:

1. Read `wiki/_meta/index.md` first.
2. Identify likely relevant pages.
3. Read the smallest set of pages that can answer well.
4. Follow wikilinks. When a page you read contains `[[link-name]]` wikilinks relevant to the question, resolve and read those linked pages too. Wikilinks are not decoration; they are paths to evidence. For example, `[[concept-name]]` maps to `wiki/concepts/concept-name.md`, and `[[source-example]]` maps to `wiki/sources/source-example.md`.
5. Traverse recursively. If a linked page contains further relevant wikilinks, follow them to a reasonable depth of 2–3 hops. Stop when the question is answered or no more relevant links exist.
6. If wiki evidence is missing or too thin, or exact verification/coverage is
   needed, consult canonical `raw/`. When SQLite helpers exist, prefer
   `wiki_retrieval.py search --raw-fallback` after wiki-first lookup, or use
   `raw_retrieval.py search` directly for source planning. Keep raw candidates
   separate and reopen their listed byte ranges before use.
7. Synthesize an answer grounded in the wiki and any explicitly verified raw evidence.
8. If the answer is durable, save it into `wiki/analyses/`.
9. Cross-link that analysis page from relevant pages if appropriate.
10. Append a `query` log entry for substantial work.

## Link Traversal Rules

- **Minimum depth.** For any question involving two or more concepts, follow at least 2 hops of relevant wikilinks before answering. Do not stop at the first page.
- **Fan-out.** When a page links to multiple concepts relevant to the question, read all of those linked pages, not just the first.
- **Refuse when evidence is absent.** If, after traversing up to 3 hops, no evidence supports an answer, explicitly state that the evidence is absent. Do not fabricate an answer.
- **Track the path.** Before answering, list every page read in traversal order.

## New Thread Bootstrap

When a new agent opens this repository in a fresh conversation:

1. Read `AGENTS.md` first.
2. Read `wiki/_meta/index.md` before answering wiki questions.
3. Read `wiki/_meta/log.md` if recent work or unfinished threads may matter.
4. Treat this repository as a persistent wiki workspace, not a one-shot chat scratchpad.
5. Prefer updating `wiki/` pages over leaving durable synthesis only in chat.

Default startup assumptions:

- This repo-specific `AGENTS.md` is the primary operating contract for future agents working inside this project.
- The local CLI in `scripts/llm_wiki.py` is support tooling, not the source of truth.
- If a future agent can answer from existing wiki pages, it should avoid rereading the full raw corpus unless needed for verification or coverage.

## AGENTS Vs Skills

For this repository:

- Prefer `AGENTS.md` for repo-specific workflow, page conventions, ingest/query rules, and maintenance behavior.
- Prefer a reusable skill only if the behavior should work across many repositories or outside this specific vault.
- Do not assume a custom skill will auto-activate in future conversations unless the environment explicitly exposes and triggers that skill.
- Therefore, if reliability for the next agent is the goal, encode the rule here in `AGENTS.md` and keep examples in `README.md` or `wiki/_meta/`.
- Certified raw ingest is the explicit exception: it requires `llm-wiki-loop`.

## Lint Workflow

When the user asks for a health check:

Look for:

- broken wikilinks
- orphan pages
- duplicate pages with overlapping scope
- important concepts mentioned repeatedly but lacking pages
- stale summaries
- unsupported claims
- contradictions not yet surfaced

When possible, fix issues directly and record the pass in the log.

## Writing Style

- Be factual, compressed, and explicit
- Prefer synthesis over paraphrase
- Preserve provenance
- Use bullet lists when they make scanning easier
- Avoid hype language
- Distinguish fact, inference, and speculation

## Naming

- Use kebab-case filenames
- Keep names stable once linked widely
- Prefer descriptive filenames over cute ones

Examples:

- `wiki/sources/source-2026-04-08-karpathy-llm-wiki.md`
- `wiki/concepts/persistent-synthesis.md`
- `wiki/analyses/analysis-2026-04-08-rag-vs-llm-wiki.md`

## Maintenance Defaults

- If a new answer would be useful later, save it
- If a page is thin but necessary, create a stub instead of omitting it
- If a source changes the meaning of an older page, revise the older page
- If a source conflicts with earlier material, note the conflict explicitly

## Safe Boundaries

- Do not silently delete meaningful content
- If merging or renaming broad pages, preserve redirects or update all inbound links
- Do not overstate certainty
- Do not fabricate citations or source coverage

## Human Collaboration

Default assumption:

- The human wants the wiki to compound over time
- The agent should leave behind clean artifacts, not just temporary chat output

If unsure whether something belongs in the wiki, prefer asking:
`Should I save this as a wiki page?`

## Loop Runtime Boundary

Do not expect `scripts/wiki_workflow.py`, `scripts/wiki_batch.py`, or
`scripts/pipeline_check.py` in this repository. They are intentionally owned and
executed by `llm-wiki-loop`. The skill validates this wiki with its own runtime,
then writes only durable run state, receipts, and canonical wiki changes here.

## Onputer Product Wiki Scope

- This vault documents onputer product reasoning, proposals, decisions, and evidence; runtime source stays in the parent repository.
- The active Codex agent is the semantic judgment owner and available runner for source synthesis and final review. Structural tools do not replace that judgment.
- Preserve the difference between implemented-at-a-specific-commit, proposed, accepted, deferred, and validated. Wiki creation alone does not approve feature implementation.
- The initial corpus is the 2026-09-06 product-proposal conversation record. Link to commit-specific code evidence rather than claiming snapshots stay current forever.
- Write reader-facing content in Korean. Use stable English kebab-case filenames and Korean wikilink display aliases.

<!-- LLM_WIKI_CONTRACT_END -->


## Derived Retrieval

- SQLite retrieval was not enabled during bootstrap.
- Markdown remains the complete truth and reading surface.
- SQLite may be enabled later by installing the active retrieval helpers intentionally; it is not required for wiki maintenance.
- Final workflow output reports retrieval as `not_enabled`; canonical Markdown completion remains independent.
