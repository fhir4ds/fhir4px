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
- SMART dev sandbox (build/test-harness/smart-dev-sandbox, cloned from
  smart-on-fhir/smart-dev-sandbox — build/ is gitignored, re-clone if wiped):
  HAPI r4 OOM-kills on big fixture loads unless a docker-compose.override.yml
  raises the limit (memory 6g + JAVA_OPTS=-Xmx4g). After a hard restart the
  H2 volume can corrupt ("Negative position") — fix: `docker compose rm -f r4`,
  delete volume `smart-dev-sandbox_r4-database`, `up -d r4`, then reload all
  fixture sets (defaults + chronic + epic-sandbox) via sandbox:load-fixtures.
  A machine restart only stops the containers and keeps the data volume:
  `docker compose up -d r4` in that directory brings the server back with
  every loaded fixture intact (no reload needed). Check
  localhost:4004/.../fhir/metadata before loading a patient in tests.
- Epic sandbox API pulls need the full SMART auth-code flow (PKCE, redirect
  http://localhost:3000, MyChart two-step login, "Allow access" consent) with
  the registered non-prod client ID; plain Epic-Client-ID calls now 401.
  Observation search requires a `category` param. Epic IDs can be invalid for
  HAPI (>64 chars / dots) — re-id with reference rewriting (see
  tests/fixtures/fhir/epic-sandbox/).
