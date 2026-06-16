import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";

export function LlmPlayground() {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h2">LLM Lab</Typography>
          <Alert severity="info">
            The WebLLM playground is being migrated to transformers.js (Gemma 4 E2B).
            A new playground for testing the transformers.js model will be available soon.
          </Alert>
        </Stack>
      </CardContent>
    </Card>
  );
}
