import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";
import type { PropsWithChildren } from "react";

export function StatusPanel({
  title,
  severity = "info",
  children
}: PropsWithChildren<{ title: string; severity?: "info" | "success" | "warning" | "error" }>) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h2">{title}</Typography>
          <Alert severity={severity}>{children}</Alert>
        </Stack>
      </CardContent>
    </Card>
  );
}
