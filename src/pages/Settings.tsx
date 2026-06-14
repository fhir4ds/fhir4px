import { Alert, Button, Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material";
import { Fingerprint, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { clearTransientState } from "../lib/smart/transient-state";
import {
  clearSessionVaultKey,
  clearWebAuthnPrfProfile,
  createWebAuthnPrfProfile,
  isWebAuthnPrfPotentiallyAvailable,
  loadWebAuthnPrfProfile,
  type WebAuthnPrfProfile
} from "../lib/vault/keys";
import { localVault } from "../lib/vault/store";

export function Settings() {
  const [profile, setProfile] = useState<WebAuthnPrfProfile | null>(null);
  const [webAuthnAvailable, setWebAuthnAvailable] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWebAuthnAvailable(isWebAuthnPrfPotentiallyAvailable());
    setProfile(loadWebAuthnPrfProfile());
  }, []);

  async function clearAll() {
    clearTransientState();
    await localVault.clear();
    clearSessionVaultKey();
    setStatus("Local data cleared");
  }

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
          <Button color="error" variant="outlined" startIcon={<Trash2 size={18} />} onClick={() => void clearAll()}>
            Clear local data
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
