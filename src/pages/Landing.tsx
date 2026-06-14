import { Box, Button, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { ArrowRight, FileText, LockKeyhole, Plug, Search, Share2 } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";

const MINT = "#00b4d8";
const MINT_LIGHT = "#90e0ef";

export function Landing() {
  return (
    <Stack spacing={6}>
      <Stack spacing={2} alignItems="flex-start">
        <Chip
          label="Zero server-side data custody"
          size="small"
          sx={{ color: MINT_LIGHT, borderColor: MINT, bgcolor: "rgba(0, 180, 216, 0.08)" }}
          variant="outlined"
        />
        <Typography variant="h1" sx={{ background: `linear-gradient(90deg, ${MINT_LIGHT}, ${MINT})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          FHIR for Patient Exchange
        </Typography>
        <Typography variant="h4" color="text.secondary">
          Zero custody, infinite transit.
        </Typography>
        <Typography color="text.secondary" maxWidth="md">
          Your medical history shouldn't belong to a health system network. It belongs to you. fhir4px is
          a patient-side orchestrator that fetches your records directly from your providers, keeps them
          encrypted in your browser, and lets you hand them off on your terms. We don't dam the river or
          store the data. We build the pipes.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Button
            component={RouterLink}
            to="/app"
            variant="contained"
            size="large"
            endIcon={<ArrowRight size={18} />}
            sx={{ bgcolor: MINT, "&:hover": { bgcolor: MINT_LIGHT } }}
          >
            Get started
          </Button>
          <Button component={RouterLink} to="/docs" variant="outlined" size="large" startIcon={<FileText size={18} />}>
            Read the docs
          </Button>
        </Stack>
      </Stack>

      <Box>
        <Stack direction="row" spacing={2} alignItems="baseline" mb={3}>
          <Box>
            <Typography variant="overline" color={MINT_LIGHT}>How it works</Typography>
            <Typography variant="h3">Find. Connect. Share.</Typography>
          </Box>
        </Stack>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <HowItWorksCard
            icon={<Search size={20} />}
            step="1"
            title="Find"
            description="Search the public provider directory by name, specialty, or location to discover your provider's FHIR endpoint."
          />
          <HowItWorksCard
            icon={<Plug size={20} />}
            step="2"
            title="Connect"
            description="Authorize through your provider's patient portal via SMART-on-FHIR. fhir4px never sees your portal credentials."
          />
          <HowItWorksCard
            icon={<Share2 size={20} />}
            step="3"
            title="Share"
            description="Generate a referral handoff -- direct source pull, encrypted QR summary, or local encrypted Bundle -- without sending records to fhir4px."
            badge="Planned"
          />
        </Stack>
      </Box>

      <Box>
        <Typography variant="overline" color={MINT_LIGHT}>Architecture</Typography>
        <Typography variant="h3" mb={3}>Your privacy isn't a policy. It's an architectural boundary.</Typography>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <Card variant="outlined" sx={{ flex: 1, bgcolor: "rgba(0, 180, 216, 0.04)" }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                <LockKeyhole size={18} color={MINT_LIGHT} />
                <Typography variant="h6">Encrypted in your browser</Typography>
              </Stack>
              <Typography color="text.secondary" variant="body2">
                Records, tokens, and patient-authored edits live in your browser's IndexedDB, encrypted
                via the Web Crypto API under a key derived from your device passkey (WebAuthn PRF). A
                server breach can't expose what was never sent.
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ flex: 1, bgcolor: "rgba(0, 180, 216, 0.04)" }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                <Share2 size={18} color={MINT_LIGHT} />
                <Typography variant="h6">Direct to the receiver</Typography>
              </Stack>
              <Typography color="text.secondary" variant="body2">
                Handoffs flow patient-to-source, source-to-receiver, or patient-to-receiver. fhir4px
                servers hold only static app code and the public provider directory -- never records,
                tokens, or payloads.
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ flex: 1, bgcolor: "rgba(0, 180, 216, 0.04)" }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                <FileText size={18} color={MINT_LIGHT} />
                <Typography variant="h6">Open source</Typography>
              </Stack>
              <Typography color="text.secondary" variant="body2">
                The entire client is on GitHub. Read the source, verify the security model, file issues,
                or contribute. Trust comes from verifiability, not from a marketing page.
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      </Box>

      <Card variant="outlined" sx={{ bgcolor: "rgba(0, 180, 216, 0.04)", borderColor: MINT }}>
        <CardContent>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }} justifyContent="space-between">
            <Box>
              <Typography variant="h5">Ready to take your records back?</Typography>
              <Typography color="text.secondary" variant="body2">
                Free. No account. No data leaves your device. Portal connection is live; referral
                handoffs are in development.
              </Typography>
            </Box>
            <Button
              component={RouterLink}
              to="/app"
              variant="contained"
              size="large"
              endIcon={<ArrowRight size={18} />}
              sx={{ bgcolor: MINT, "&:hover": { bgcolor: MINT_LIGHT }, whiteSpace: "nowrap" }}
            >
              Connect a portal
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Box
        sx={{
          borderTop: 1,
          borderColor: "rgba(144, 224, 239, 0.2)",
          pt: 3,
          mt: 4
        }}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} justifyContent="space-between" alignItems={{ sm: "center" }}>
          <Typography color="text.secondary" variant="body2">
            fhir4px &middot; FHIR for Patient Exchange
          </Typography>
          <Stack direction="row" spacing={3}>
            <RouterLink to="/docs" style={{ color: MINT_LIGHT, textDecoration: "none", fontSize: "0.875rem" }}>
              Docs
            </RouterLink>
            <RouterLink to="/terms" style={{ color: MINT_LIGHT, textDecoration: "none", fontSize: "0.875rem" }}>
              Terms
            </RouterLink>
            <RouterLink to="/privacy" style={{ color: MINT_LIGHT, textDecoration: "none", fontSize: "0.875rem" }}>
              Privacy
            </RouterLink>
            <a
              href="https://github.com/fhir4ds/fhir4px"
              target="_blank"
              rel="noreferrer"
              style={{ color: MINT_LIGHT, textDecoration: "none", fontSize: "0.875rem" }}
            >
              GitHub
            </a>
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}

interface HowItWorksCardProps {
  icon: React.ReactNode;
  step: string;
  title: string;
  description: string;
  badge?: string;
}

function HowItWorksCard({ icon, step, title, description, badge }: HowItWorksCardProps) {
  return (
    <Card variant="outlined" sx={{ flex: 1, bgcolor: "rgba(0, 180, 216, 0.04)" }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" mb={1} justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center">
            <Box sx={{ color: "#90e0ef" }}>{icon}</Box>
            <Typography variant="h6">{title}</Typography>
          </Stack>
          {badge ? (
            <Chip
              label={badge}
              size="small"
              variant="outlined"
              sx={{ color: MINT_LIGHT, borderColor: MINT, fontSize: "0.7rem" }}
            />
          ) : (
            <Typography variant="overline" color="#90e0ef">Step {step}</Typography>
          )}
        </Stack>
        <Typography color="text.secondary" variant="body2">{description}</Typography>
      </CardContent>
    </Card>
  );
}
