import { Container, Link, Stack, Typography } from "@mui/material";

export function Terms() {
  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={4}>
        <Stack spacing={1}>
          <Typography variant="h2">Terms of Service</Typography>
          <Typography color="text.secondary">Last updated: June 2026</Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">1. About These Terms</Typography>
          <Typography>
            These Terms govern your use of <strong>fhir4px</strong> ("the app"), a patient-facing web
            application operated as a static, browser-only service. By accessing the app, you agree to
            these Terms. If you do not agree, do not use the app.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">2. What the App Does</Typography>
          <Typography>
            fhir4px helps you (a) find a healthcare provider's FHIR endpoint, (b) connect to that
            provider's patient portal using the SMART-on-FHIR standard, (c) view a normalized view of
            your health records in your browser, and (d) generate referral handoffs you can share with
            receiving clinicians.
          </Typography>
          <Typography>
            The app runs entirely in your browser. The operator of fhir4px does not operate a backend
            that receives, stores, or relays your health records, OAuth tokens, or referral payloads.
            See our <Link href="/privacy">Privacy Policy</Link> for the specifics.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">3. Not Medical Advice</Typography>
          <Typography>
            <strong>fhir4px is not a medical device and does not provide medical advice, diagnosis, or
            treatment.</strong> The records displayed come from your providers and may be incomplete,
            outdated, or contain errors. Annotations you add to your records are patient-reported
            context, not clinical determinations.
          </Typography>
          <Typography>
            Always consult a qualified healthcare professional before making decisions based on
            information shown in the app. In an emergency, call your local emergency number — do not
            rely on this app.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">4. Your Responsibilities</Typography>
          <Typography>You agree to:</Typography>
          <ul>
            <li>Use the app only to access your own records or records you are legally authorized to access.</li>
            <li>Not abuse, reverse-engineer, or attempt to overload the app or any provider's FHIR endpoint.</li>
            <li>Comply with the terms of your provider's patient portal when initiating a SMART connection.</li>
            <li>Keep your browser and device secure — the app stores data locally under your control.</li>
          </ul>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">5. Third-Party Providers</Typography>
          <Typography>
            When you connect to a healthcare provider (e.g., Epic, Oracle Health / Cerner, athenahealth),
            you are interacting with that provider's systems under their own terms and privacy policy.
            fhir4px is independent from these providers and is not responsible for their availability,
            accuracy, data practices, or conduct.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">6. No Warranty</Typography>
          <Typography>
            The app is provided <strong>"as is"</strong> and <strong>"as available,"</strong> without
            warranties of any kind — express or implied — including merchantability, fitness for a
            particular purpose, or non-infringement. The operator does not warrant that the app will be
            uninterrupted, error-free, secure, or that records from any specific provider will be
            accessible.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">7. Limitation of Liability</Typography>
          <Typography>
            To the maximum extent permitted by law, the operator of fhir4px shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages — including loss of data,
            loss of records, or inability to access care — arising out of or related to your use of, or
            inability to use, the app.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">8. Data Control and Deletion</Typography>
          <Typography>
            Because the app stores all data in your browser, you can delete everything at any time by:
          </Typography>
          <ul>
            <li>Using <strong>Settings → Clear local data</strong> inside the app, or</li>
            <li>Clearing site data in your browser's settings for <code>app.fhir4ds.com</code>.</li>
          </ul>
          <Typography>
            There is no server-side data store for the operator to clear on your behalf, because no
            patient data is ever sent to fhir4px servers.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">9. Changes to These Terms</Typography>
          <Typography>
            The operator may update these Terms from time to time. Material changes will be reflected by
            updating the "Last updated" date above. Continued use after changes take effect constitutes
            acceptance of the revised Terms.
          </Typography>
        </Stack>

        <Stack spacing={1}>
          <Typography variant="h5">10. Contact</Typography>
          <Typography>
            Questions about these Terms can be filed as an issue at the project's GitHub repository.
            These Terms are an engineering-level draft and have not been reviewed by legal counsel.
          </Typography>
        </Stack>
      </Stack>
    </Container>
  );
}
