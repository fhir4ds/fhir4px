import { Alert, Button, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { listConnectedSources, sourceLabel, type ConnectedSource } from "../lib/smart/sources";
import { clearSessionVaultKey, getOrCreateSessionVaultKey } from "../lib/vault/keys";
import { localVault } from "../lib/vault/store";

export function ConnectedProvider() {
  const [sources, setSources] = useState<ConnectedSource[]>([]);

  async function load() {
    const key = await getOrCreateSessionVaultKey();
    setSources(await listConnectedSources(key));
  }

  async function clear() {
    await localVault.clear();
    clearSessionVaultKey();
    setSources([]);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h2">Local vault</Typography>
          {sources.length > 0 ? (
            <>
              <Alert severity="success">
                Portal connections and token material are encrypted in the local vault for this browser session.
              </Alert>
              <Stack spacing={1}>
                {sources.map((source) => (
                  <Card key={source.id} variant="outlined">
                    <CardContent>
                      <Stack spacing={1}>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                          <Typography variant="h3">{sourceLabel(source)}</Typography>
                          <Chip size="small" label={source.status} />
                          {source.recordCount !== undefined && <Chip size="small" label={`${source.recordCount} resources`} />}
                        </Stack>
                        <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                          {source.fhirBaseUrl}
                        </Typography>
                        {source.lastFetchedAt && (
                          <Typography color="text.secondary">
                            Last fetched {new Date(source.lastFetchedAt).toLocaleString()}
                          </Typography>
                        )}
                        {source.lastError && <Alert severity="warning">{source.lastError}</Alert>}
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button component={RouterLink} to="/records" variant="contained" startIcon={<RefreshCcw size={18} />}>
                  View records
                </Button>
                <Button component={RouterLink} to="/providers" variant="outlined">
                  Add portal
                </Button>
                <Button component={RouterLink} to="/referral" variant="outlined" startIcon={<RefreshCcw size={18} />}>
                  Referral summary
                </Button>
                <Button variant="outlined" color="error" onClick={() => void clear()} startIcon={<Trash2 size={18} />}>
                  Clear local data
                </Button>
              </Stack>
            </>
          ) : (
            <Alert severity="warning">
              No decryptable local connection is available. Connect to a provider or re-auth after reload.
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
