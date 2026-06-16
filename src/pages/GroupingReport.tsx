import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";

export function GroupingReport() {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h2">Grouping Report</Typography>
          <Alert severity="info">
            The grouping report is being migrated to the new transformers.js naming pipeline.
            It will return once the Gemma 4 model integration is complete.
          </Alert>
        </Stack>
      </CardContent>
    </Card>
  );
}
