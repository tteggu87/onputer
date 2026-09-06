# Frozen semantic plan

- Source: raw/notes/2026-09-06-onputer-product-proposals.md (only source)
- Mode: full; 10 units = H1 introduction + nine numbered H2 sections.
- Contract: AGENTS.md managed wiki-only contract, SQLite off, Markdown canonical.
- Semantic owner/runner: active Codex agent; no helper model or fallback synthesis.
- Existing scope inspected: starter index/dashboard/log only, no overlapping product pages.
- Write surfaces: one source page; onputer-product project page; feature-candidates, user-experiences, roadmap, open-decisions analysis pages; index/dashboard/log and applied coverage receipt.
- Unit mapping: intro and section9 -> source page; section1 -> product page; sections2/3 -> feature-candidates; sections4/5 -> user-experiences; sections6/7 -> roadmap; section8 -> roadmap and open-decisions.
- Preserve proposal status, implementation snapshot at f546732, all examples and boundaries; do not promote proposals to accepted requirements.
- Validate with local lint and skill-owned wiki_loop.py check --source; record validation and final review against latest fingerprint, then workflow finish.
- Single source: no batch certification required. SQLite not enabled. No ontology output.
- Failure posture: not_ready for missing units, broken links or stale review; blocked only if semantic owner unavailable; do not call incomplete coverage ready.
