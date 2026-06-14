import { Container, Link, Stack, Typography } from "@mui/material";

export function Privacy() {
  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Stack spacing={1}>
          <Typography variant="h2">Privacy Policy</Typography>
          <Typography color="text.secondary">Last updated: June 2026</Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="overline" color="primary.main">The short version</Typography>
          <Typography>
            <strong>fhir4px has zero server-side data custody.</strong> Your health records, OAuth
            tokens, patient-authored edits, and referral payloads are processed in your browser and
            stored in your browser's encrypted local storage. They are never sent to, stored on, or
            relayed through fhir4px servers. The operator of fhir4px cannot read your records, even if
            compelled to.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">1. Data the App Holds Locally</Typography>
          <Typography>When you use fhir4px, the following may be stored in your browser:</Typography>
          <ul>
            <li>
              <strong>OAuth tokens</strong> issued by your provider's FHIR endpoint (encrypted under a
              key derived from your device passkey via the WebAuthn PRF extension; or, if no passkey is
              registered, a session-only key that is lost when the browser closes).
            </li>
            <li>
              <strong>FHIR resources</strong> fetched from your provider (encrypted in IndexedDB,
              decrypted only while the app is open).
            </li>
            <li>
              <strong>Patient-authored patches</strong> — your annotations or corrections to records
              (encrypted alongside the resources they apply to).
            </li>
            <li>
              <strong>Encrypted referral handoff artifacts</strong> you generate (only while you choose
              to keep them; you can delete or export at any time).
            </li>
          </ul>
          <Typography>
            None of the above is ever transmitted to fhir4px servers. The app does not use analytics,
            telemetry, error reporting, or advertising trackers that would send record content, tokens,
            or patient identity off-device.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">2. Data the Operator Holds</Typography>
          <Typography>The operator of fhir4px hosts only:</Typography>
          <ul>
            <li>The static app bundle (HTML, CSS, JavaScript) on GitHub Pages.</li>
            <li>A public provider-directory JSON artifact (provider names, NPIs, FHIR endpoint URLs).</li>
            <li>Public terminology lookup data (LOINC, SNOMED, RxNorm mappings).</li>
          </ul>
          <Typography>
            None of these contain patient-specific information, OAuth tokens, or records. Standard web
            server access logs may exist at the CDN layer (GitHub Pages / Cloudflare); these typically
            include IP address, request time, and user agent, but are not associated with any patient
            identity or record content by the operator.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">3. OAuth Scopes the App Requests</Typography>
          <Typography>
            When you connect a provider, the app requests the minimum scopes needed to display your
            records. The current scope set is visible in the{" "}
            <Link href="https://github.com/fhir4ds/fhir4px/blob/main/src/lib/smart/scopes.ts" target="_blank" rel="noreferrer">
              scopes.ts
            </Link>{" "}
            source file. Typically:
          </Typography>
          <ul>
            <li><code>launch/patient</code>, <code>openid</code>, <code>fhirUser</code> — establish patient context.</li>
            <li>
              <code>patient/&lt;Resource&gt;.read</code> for clinical resources (Patient, MedicationRequest,
              AllergyIntolerance, Condition, Observation, etc.).
            </li>
          </ul>
          <Typography>
            The app never requests write scopes (<code>*.write</code>) and cannot modify your records on
            the provider's EHR. Patient-authored edits live only in your local browser.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">4. Third Parties</Typography>
          <Typography>
            <strong>Your healthcare provider's EHR</strong> (Epic, Oracle Health, athenahealth, etc.) is
            the source of your records and operates under its own privacy policy. When the app fetches
            your data, it goes directly from the provider to your browser — not through fhir4px servers.
          </Typography>
          <Typography>
            <strong>GitHub Pages and Cloudflare</strong> host and serve the static app bundle and may
            log requests at the CDN layer as described above.
          </Typography>
          <Typography>
            <strong>In-browser LLM (optional)</strong>: if you use the patient-friendly grouping feature,
            a small language model is downloaded and executed locally in your browser via WebGPU. No
            record content is sent to any LLM API.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">5. Cookies and Local Storage</Typography>
          <Typography>
            The app uses browser <strong>IndexedDB</strong> and <strong>localStorage</strong> for the
            encrypted vault, the public directory cache, and the service worker (for offline support).
            No tracking cookies are set.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">6. Children's Privacy</Typography>
          <Typography>
            The app is not directed at children under 13 (or the equivalent minimum age in the relevant
            jurisdiction). A parent or legal guardian should initiate connections and manage records on
            behalf of minors. Pediatric records are treated identically to any other record: stored
            locally under the patient's control, never sent to fhir4px servers.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">7. Data Retention and Deletion</Typography>
          <Typography>
            All your data lives in your browser. The operator has nothing to delete on your behalf
            because the operator has nothing of yours. To delete your local data:
          </Typography>
          <ul>
            <li>Use <strong>Settings → Clear local data</strong> inside the app, or</li>
            <li>Clear site data in your browser's settings for <code>app.fhir4ds.com</code>.</li>
          </ul>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">8. Security Safeguards</Typography>
          <Typography>
            All local data is encrypted via the Web Crypto API (AES-GCM). The encryption key is either
            derived on-demand from your device passkey via WebAuthn PRF (recommended), or generated as a
            session-only key (cleared when the browser closes). Communication with provider FHR servers
            uses HTTPS. See the <Link href="/docs">documentation</Link> for the full security model.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">9. Your Rights</Typography>
          <Typography>
            Because fhir4px holds no patient data on its servers, traditional data-subject requests
            (access, correction, deletion, portability) are fulfilled by you directly: the data is in
            your browser, you control it. For questions about records held by your provider, contact
            that provider directly.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">10. Changes to This Policy</Typography>
          <Typography>
            The operator may update this Privacy Policy from time to time. Material changes will be
            reflected by updating the "Last updated" date above.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">11. Contact</Typography>
          <Typography>
            Questions can be filed as an issue at the project's GitHub repository. This policy is an
            engineering-level draft and has not been reviewed by legal counsel.
          </Typography>
        </Stack>
      </Stack>
    </Container>
  );
}
