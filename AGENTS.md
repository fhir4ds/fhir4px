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
- Opt-in e2e specs need the local Docker sandbox and a dev server:
  `SMART_DEV_SANDBOX_E2E=1 [PLAYWRIGHT_PORT=<port>] npx playwright test
  tests/e2e/<spec>` (port 3000 is often taken by another project). After any
  fhir4ds wheel bump run `quality-measures.spec.ts`: fhir4ds <=0.0.26 emits
  invalid CMS159 SQL unless `translate_library()` is called before
  `translate_library_to_population_sql()` (see src/lib/engine/viewdef.ts).
- SQL source has two modes. `npm run dev` and `npm run build` translate the
  CQL, view definitions and OMOP libraries live in the browser (Pyodide + the
  fhir4ds wheel). `npm run build:prebuilt` first runs `npm run prebuild:sql`
  (scripts/prebuild_sql.py: the same wheel on the build machine's Python;
  `pip install public/vendor/fhir4ds/*.whl` gives its dependencies) and writes
  public/fhir4ds/prebuilt/ (gitignored). The app loads that SQL and falls back
  to live translation for anything missing; measure SQL carries `{{YEAR}}` for
  the measurement period. After a wheel or CQL bump, in prebuilt mode run
  `PREBUILT_SQL_E2E=1 PLAYWRIGHT_PORT=<port> npx playwright test
  tests/e2e/prebuilt-sql.spec.ts`: it proves the generated files equal the
  live translation. The Pages workflow uses prebuilt only when the repository
  variable `SQL_MODE` is `prebuilt`.
- fhir4ds deduplication and patient matching run in a background worker with
  its own Pyodide (src/lib/engine/fhir4ds.worker.ts). The page is
  cross-origin isolated, and a browser then refuses to start a worker whose
  script file lacks the COOP/COEP headers, so the worker is started from an
  in-memory script that imports the worker module
  (src/lib/engine/fhir4ds-client.ts) — keep it that way on any host. Records
  are first shown with the fast local rule (src/lib/fhir/dedupe.ts); once the
  worker reports, fhir4ds decides for every record it examined.
- One person is shown at a time. The patient switcher (app header) appears when
  the connected portals belong to more than one person; the choice is kept by
  portal and scopes records, care gaps, measures and cohorts to that person
  (the quality evaluation gets the person's resources through
  `setQualityScopeResources`, src/lib/fhir/quality-run.ts). Portals are grouped
  by fhir4ds patient matching plus name and birth date. A person is named by
  exactly one of its portals; the connection menu gives every portal the list of
  portal names (its own, and "same as …" each other), so choosing another name
  hands the naming over and the portals that pointed at a portal move with it.
  The choices are a `patient-identity` vault record
  (src/lib/fhir/patient-identity.ts), and "Reset to matching" clears them.
  Every switch re-runs the measures and cohorts (about 10-15 s in the sandbox).
- The connection menu (src/components/ConnectionMenu.tsx) lists each portal with
  its own refresh and delete; deleting one portal removes its connection,
  token/session, records, patches on those records and its patient's care-gap
  dismissals, and re-points the legacy "current" session that the quality
  evaluation reads (src/lib/vault/delete-source.ts). There is no portal filter:
  the header selector is the only scope control.
- The service worker updates itself (`registerType: "autoUpdate"`, registered
  by hand in src/lib/pwa/register-sw.ts): a returning page reloads once when a
  new build takes over. It never reloads the first visit, /smart/callback, or
  while something holds the update (src/lib/pwa/update-hold.ts — the export
  page holds it while building).
