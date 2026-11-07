# fhir4px

FHIR profiling tooling: profiling rules, structure definitions, and validation
surfaces for the fhir4px model stack. Sibling repos: `fhir4px-model` (research),
`fhir4px-guidelines`, `fhir4px-structured-data` — coordinate cross-repo changes
peer-to-peer.

## Commands
- Follow repo README / CI.

## Gotchas
- `.oc-serve/` and `.opencode/` are runtime dirs (gitignored; never commit).
- v2 worktree discipline: one named worktree per concurrent writer; do not
  accumulate dated research worktrees on disk (2026-11-04 cleanup reclaimed
  ~175GB from 66 stale ones).
