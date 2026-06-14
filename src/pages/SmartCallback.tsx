import { Alert, Card, CardContent, CircularProgress, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { handleSmartCallback } from "../lib/smart/callback";
import { publishSmartAuthPopupMessage } from "../lib/smart/popup";
import { upsertConnectedSource, type ConnectedSource } from "../lib/smart/sources";
import { getOrCreateSessionVaultKey } from "../lib/vault/keys";

export function SmartCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("Encrypting token material into the local vault.");

  useEffect(() => {
    let active = true;
    let source: ConnectedSource | null = null;

    void handleSmartCallback({
      async onToken(result) {
        const key = await getOrCreateSessionVaultKey();
        setMessage("Saving portal connection locally.");
        source = await upsertConnectedSource(key, result.session, result.token);
      }
    })
      .then((result) => {
        if (result.popupLaunch) {
          publishSmartAuthPopupMessage({
            type: "fhir4px.smartAuth.complete",
            sourceId: source?.id
          });
          setMessage("Portal connected. You can close this window.");
          window.setTimeout(() => window.close(), 500);
          return;
        }
        if (active) navigate("/records", { replace: true });
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "SMART callback failed";
        publishSmartAuthPopupMessage({ type: "fhir4px.smartAuth.error", error: message });
        if (active) setError(message);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2} alignItems="flex-start">
          <Typography variant="h2">Completing SMART connection</Typography>
          {error ? (
            <Alert severity="error">{error}</Alert>
          ) : (
            <Stack direction="row" spacing={2} alignItems="center">
              <CircularProgress size={22} />
              <Typography color="text.secondary">{message}</Typography>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
