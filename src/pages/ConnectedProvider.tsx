import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { listConnectedSources, sourceLabel, type ConnectedSource } from "../lib/smart/sources";
import { getOrCreateSessionVaultKey } from "../lib/vault/keys";
import { localVault } from "../lib/vault/store";
import { clearAllLocalData } from "../lib/vault/clear-local";

export function ConnectedProvider() {
  const [sources, setSources] = useState<ConnectedSource[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function load() {
    const key = await getOrCreateSessionVaultKey();
    setSources(await listConnectedSources(key));
  }

  useEffect(() => {
    void load();
  }, []);

  const recordTotal = sources.reduce((sum, source) => sum + (source.recordCount ?? 0), 0);

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
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button component={RouterLink} to="/records" variant="outlined" startIcon={<RefreshCcw size={16} />}>
                            View records
                          </Button>
                          <Button component={RouterLink} to="/referral" variant="outlined" startIcon={<RefreshCcw size={16} />}>
                            Referral summary
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button variant="outlined" color="error" onClick={() => setConfirmOpen(true)} startIcon={<Trash2 size={18} />}>
                  Clear local data
                </Button>
              </Stack>
            </>
          ) : (
            <Alert severity="warning">
              No portal connections stored yet. Connect a portal from the <RouterLink to="/providers">provider search</RouterLink>.
            </Alert>
          )}
        </Stack>
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Clear all local data?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" component="div">
            <Box component="p" mb={1}>
              This permanently deletes all locally stored patient data
              {sources.length > 0 && (
                <>
                  {" "}— {sources.length} connection{sources.length === 1 ? "" : "s"}
                  {recordTotal > 0 && ` with ${recordTotal.toLocaleString()} records`}
                </>
              )}
              :
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
