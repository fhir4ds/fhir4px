import { Box, Container, Link, Stack, Typography } from "@mui/material";

const MINT_LIGHT = "#90e0ef";

export function Docs() {
  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={5}>
        <Stack spacing={1}>
          <Typography variant="overline" color={MINT_LIGHT}>Documentation</Typography>
          <Typography variant="h2">How fhir4px works</Typography>
          <Typography color="text.secondary">
            A patient-facing health record orchestrator built around three principles: zero server-side
            data custody, browser-native encryption, and open standards.
          </Typography>
        </Stack>

        <Section title="What is fhir4px?">
          <Typography>
            fhir4px is a free, browser-only Progressive Web App that helps you (a) discover your
            healthcare provider's FHIR endpoint, (b) connect to your provider's patient portal using
            the SMART-on-FHIR standard, (c) view a normalized view of your records in your browser,
            and (d) generate referral handoffs you can share with receiving clinicians.
          </Typography>
          <Typography>
            The 21st Century Cures Act mandates that health systems expose standardized APIs (FHIR R4)
            for patient data access. SMART-on-FHIR is the OAuth profile for patient apps to use those
            APIs. What's been missing is the patient-friendly UX layer that makes these standards
            accessible to non-technical users -- fhir4px is that layer.
          </Typography>
        </Section>

        <Section title="Architecture: zero custody">
          <Typography>
            The defining architectural commitment of fhir4px is that <strong>patient health data never
            travels through fhir4px servers.</strong> The static app bundle and a public provider
            directory are hosted on GitHub Pages; everything else stays in your browser or flows
            directly between your browser and your provider's EHR.
          </Typography>
          <Box
            component="pre"
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: "rgba(0, 0, 0, 0.3)",
              color: MINT_LIGHT,
              fontSize: "0.75rem",
              overflowX: "auto"
            }}
          >{`[ Hospital A (Silo) ] ───┐
                          ├───► [ fhir4px Browser Client ] ───► [ Referral Receiver ]
[ Hospital B (Silo) ] ───┘                  │
                                            └── fhir4px backend supplies only
                                                static code + public directory`}</Box>
          <Typography>
            Practical consequences:
          </Typography>
          <ul>
            <li>The operator of fhir4px cannot read your records, even if compelled to.</li>
            <li>A complete server breach cannot expose records, tokens, or referral payloads because none were ever sent.</li>
            <li>Nothing to sell, nothing to leak, nothing to subpoena from the operator.</li>
          </ul>
        </Section>

        <Section title="Connection: SMART-on-FHIR">
          <Typography>
            When you connect a provider, fhir4px performs a standard SMART App Launch (OAuth2 + PKCE):
          </Typography>
          <ol>
            <li>fhir4px fetches the provider's <code>.well-known/smart-configuration</code> to discover authorization and token endpoints.</li>
            <li>Your browser redirects to the provider's authorization server with the requested scopes.</li>
            <li>You authenticate directly with your patient portal credentials -- fhir4px never sees them.</li>
            <li>The provider issues an OAuth access token, which fhir4px encrypts locally and uses to fetch FHIR resources directly from the EHR.</li>
          </ol>
          <Typography>
            The scopes requested are the minimum needed to display your records. They are listed in{" "}
            <Link href="https://github.com/fhir4ds/fhir4px/blob/main/src/lib/smart/scopes.ts" target="_blank" rel="noreferrer">
              scopes.ts
            </Link>{" "}
            and are read-only. fhir4px never requests write scopes.
          </Typography>
        </Section>

        <Section title="Security: encrypted local vault">
          <Typography>
            Once fetched, your records, OAuth tokens, and patient-authored edits are stored in your
            browser's IndexedDB, encrypted via the Web Crypto API (AES-GCM). The encryption key
            handling has two modes:
          </Typography>
          <ul>
            <li>
              <strong>Passkey mode (recommended):</strong> register a device passkey (Face ID, Touch ID,
              Windows Hello). The browser derives a stable 32-byte symmetric key from the passkey via
              the WebAuthn PRF extension. The key never leaves your device's secure enclave.
            </li>
            <li>
              <strong>Session-only mode (default):</strong> if no passkey is registered, a random key is
              generated and kept only for the current browser session. Closing the browser loses the
              key (and therefore the ability to decrypt stored data).
            </li>
          </ul>
          <Typography>
            For long-term use, register a passkey in <Link href="/settings">Settings</Link>. The passkey
            syncs across your devices via iCloud Keychain or Google Password Manager where supported.
          </Typography>
        </Section>

        <Section title="Handoffs: three ways to share">
          <Box
            sx={{
              mb: 2,
              p: 1.5,
              borderRadius: 1,
              border: 1,
              borderColor: MINT_LIGHT,
              bgcolor: "rgba(144, 224, 239, 0.05)"
            }}
          >
            <Typography variant="body2" sx={{ color: MINT_LIGHT }}>
              <strong>Status: in development.</strong> The handoff modes below describe the planned
              design. Today you can connect portals and view records; the export and referral flows
              that produce these handoff artifacts are not yet built.
            </Typography>
          </Box>
          <Typography>
            fhir4px never sends your records to a fhir4px-operated server. When you generate a referral
            handoff, you choose one of three modes:
          </Typography>
          <Stack spacing={2}>
            <HandoffMode
              name="Direct source pull"
              description="The receiver pulls your records directly from the source EHR using a time-limited, scoped authorization you grant. fhir4px servers are not in the path. Best when the receiving system supports SMART Health Links or can call the source EHR directly."
            />
            <HandoffMode
              name="QR-contained summary"
              description="Your browser fetches selected FHIR resources, compresses and encrypts them into a compact payload, and renders a QR code (or deep link). The receiver scans and decrypts locally. Best for medication, allergy, problem, and referral-context summaries that fit in a QR."
            />
            <HandoffMode
              name="Local encrypted Bundle"
              description="Your browser creates an encrypted FHIR Bundle file on your device. You give it to the clinic via portal upload, AirDrop, email, or removable media. Decryption material is shared patient-to-clinic, never via fhir4px servers. Best for large medical histories."
            />
          </Stack>
        </Section>

        <Section title="Patient-authored patches">
          <Typography>
            fhir4px is not just a data courier. You can annotate your records -- mark a medication as
            discontinued, add an allergy, note a condition as resolved. These edits are stored as a
            separate FHIR Patch layer that <strong>never modifies the original provider-signed
            data.</strong> At render time, fhir4px merges both streams and clearly distinguishes
            source:
          </Typography>
          <Box
            component="pre"
            sx={{ p: 2, borderRadius: 1, bgcolor: "rgba(0, 0, 0, 0.3)", color: MINT_LIGHT, fontSize: "0.8rem", overflowX: "auto" }}
          >{`Lisinopril 10mg    -- Active (Northwestern Medicine)
Simvastatin 20mg  -- Inactive (Marked by patient, May 24 2026)`}</Box>
          <Typography>
            For clinicians, this side-by-side is precisely what medication reconciliation needs --
            comparing what the hospital believes the patient takes against what the patient reports
            actually taking.
          </Typography>
        </Section>

        <Section title="The provider directory">
          <Typography>
            The national FHIR endpoint directory is the hardest infrastructure problem in patient-side
            FHIR. fhir4px maintains a public directory seeded from NPPES, CMS open data, and public
            vendor endpoint bundles (Epic, Oracle Health, athenahealth, and others). Each entry maps a
            provider (by NPI) to one or more FHIR endpoints with confidence scoring and evidence paths.
          </Typography>
          <Typography>
            The directory is rebuilt periodically by a separate ETL pipeline. The published artifact
            (chicago-directory.json) is a static file the app fetches at runtime. It contains only
            public endpoint metadata -- never patient identity or records.
          </Typography>
        </Section>

        <Section title="FAQ">
          <Stack spacing={2}>
            <Faq
              q="What happens if I clear my browser data?"
              a="All local records, tokens, and patches are deleted. Your passkey (if registered) survives in iCloud Keychain or Google Password Manager. Reconnect your providers and the records will re-fetch from source."
            />
            <Faq
              q="Can the operator of fhir4px read my records?"
              a="No. The records, tokens, and patches are encrypted in your browser under a key derived from your device passkey. The operator has no path to decrypt them, by design."
            />
            <Faq
              q="What if my provider isn't in the directory?"
              a="The directory is seeded from public data and grows over time. If your provider isn't listed, they may not have a public FHIR endpoint. Check with their patient portal -- many portals support SMART-on-FHIR even if they aren't in the directory yet."
            />
            <Faq
              q="Is this a medical device?"
              a="No. fhir4px is a data viewer and orchestrator. It does not provide medical advice, diagnosis, or treatment. Always consult a qualified healthcare professional for clinical decisions."
            />
            <Faq
              q="Why is it called fhir4px?"
              a="FHIR for Patient Exchange. The companion project, fhir4ds (FHIR for Data Science), handles population-scale analytics. Together they form a suite: one for individual exchange, one for population insight."
            />
          </Stack>
        </Section>
      </Stack>
    </Container>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <Stack spacing={1}>
      <Typography variant="h4">{title}</Typography>
      {children}
    </Stack>
  );
}

interface HandoffModeProps {
  name: string;
  description: string;
}

function HandoffMode({ name, description }: HandoffModeProps) {
  return (
    <Box sx={{ pl: 2, borderLeft: 2, borderColor: "#00b4d8" }}>
      <Typography variant="subtitle1" sx={{ color: "#90e0ef" }}>{name}</Typography>
      <Typography color="text.secondary" variant="body2">{description}</Typography>
    </Box>
  );
}

interface FaqProps {
  q: string;
  a: string;
}

function Faq({ q, a }: FaqProps) {
  return (
    <Box>
      <Typography variant="subtitle1">{q}</Typography>
      <Typography color="text.secondary" variant="body2">{a}</Typography>
    </Box>
  );
}
