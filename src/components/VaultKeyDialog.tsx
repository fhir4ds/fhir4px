/**
 * Vault key — whether the encryption key behind the local data is kept by a
 * passkey or only for this browser session, and the two actions that change
 * it. Opened from the connection menu, next to the data it protects.
 */

import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { Fingerprint } from "lucide-react";
import { useEffect, useState } from "react";
import {
  clearWebAuthnPrfProfile,
  createWebAuthnPrfProfile,
  isWebAuthnPrfPotentiallyAvailable,
  loadWebAuthnPrfProfile,
  type WebAuthnPrfProfile
} from "../lib/vault/keys";

export default function VaultKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [profile, setProfile] = useState<WebAuthnPrfProfile | null>(null);
  const [webAuthnAvailable, setWebAuthnAvailable] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setWebAuthnAvailable(isWebAuthnPrfPotentiallyAvailable());
    setProfile(loadWebAuthnPrfProfile());
    setStatus(null);
    setError(null);
  }, [open]);

  async function register() {
    setError(null);
    setStatus(null);
    try {
      setProfile(await createWebAuthnPrfProfile());
      setStatus("Passkey vault profile registered");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not register passkey vault profile");
    }
  }

  function forget() {
    clearWebAuthnPrfProfile();
    setProfile(null);
    setStatus("Passkey vault profile forgotten");
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Vault key</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            fhir4px stores sensitive state only in the local encrypted vault or transient auth state.
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={profile ? "Passkey profile registered" : "Session-only vault key"} />
            <Chip
              size="small"
              variant="outlined"
              label={webAuthnAvailable ? "WebAuthn available" : "WebAuthn unavailable"}
              color={webAuthnAvailable ? "success" : "default"}
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {profile
              ? "A passkey holds the vault key, so the stored data can be decrypted after a restart."
              : "Without a passkey the vault key lives only in this browser session: closing the browser makes the stored data unreadable."}
          </Typography>
          {status && <Alert severity="success">{status}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="outlined"
              startIcon={<Fingerprint size={18} />}
              disabled={!webAuthnAvailable}
              onClick={() => void register()}
            >
              Register passkey vault
            </Button>
            <Button variant="outlined" disabled={!profile} onClick={forget}>
              Forget passkey vault
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
