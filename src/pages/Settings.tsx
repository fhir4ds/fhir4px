import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography } from "@mui/material";
import { Fingerprint, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  clearWebAuthnPrfProfile,
  createWebAuthnPrfProfile,
  isWebAuthnPrfPotentiallyAvailable,
  loadWebAuthnPrfProfile,
  type WebAuthnPrfProfile
} from "../lib/vault/keys";
import { clearAllLocalData } from "../lib/vault/clear-local";

export function Settings() {
  const [profile, setProfile] = useState<WebAuthnPrfProfile | null>(null);
  const [webAuthnAvailable, setWebAuthnAvailable] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWebAuthnAvailable(isWebAuthnPrfPotentiallyAvailable());
    setProfile(loadWebAuthnPrfProfile());
  }, []);

  const [confirmOpen, setConfirmOpen] = useState(false);

  async function registerWebAuthnVault() {
    setError(null);
    setStatus(null);
    try {
      const nextProfile = await createWebAuthnPrfProfile();
      setProfile(nextProfile);
      setStatus("Passkey vault profile registered");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not register passkey vault profile");
    }
  }

  function forgetWebAuthnVault() {
    clearWebAuthnPrfProfile();
    setProfile(null);
    setStatus("Passkey vault profile forgotten");
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h2">Settings</Typography>
          <Alert severity="info">
            fhir4px stores sensitive state only in the local encrypted vault or transient auth state.
          </Alert>
          {status && <Alert severity="success">{status}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}

          <Stack spacing={1}>
            <Typography fontWeight={700}>Vault key</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={profile ? "Passkey profile registered" : "Session-only vault key"} />
              <Chip
                label={webAuthnAvailable ? "WebAuthn available" : "WebAuthn unavailable"}
                color={webAuthnAvailable ? "success" : "default"}
                variant="outlined"
              />
            </Stack>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <Button
                variant="outlined"
                startIcon={<Fingerprint size={18} />}
                disabled={!webAuthnAvailable}
                onClick={() => void registerWebAuthnVault()}
              >
                Register passkey vault
              </Button>
              <Button variant="outlined" disabled={!profile} onClick={forgetWebAuthnVault}>
                Forget passkey vault
              </Button>
            </Stack>
          </Stack>

          <Divider />
          <Button color="error" variant="outlined" startIcon={<Trash2 size={18} />} onClick={() => setConfirmOpen(true)}>
            Clear local data
          </Button>
        </Stack>
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Clear all local data?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" component="div">
            <Box component="p" mb={1}>
              This permanently deletes all locally stored patient data:
            </Box>
            <Box component="ul" pl={2} mb={1}>
              <li>Portal connections and token material</li>
              <li>Fetched medical records</li>
              <li>Record groupings, patches, and authored entries</li>
              <li>Care-gap dismissals</li>
            </Box>
            <Box component="p" mt={1} fontWeight={700}>
              This cannot be undone.
            </Box>
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void clearAllLocalData()} startIcon={<Trash2 size={16} />}>
            Delete everything
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
