import { Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { ArrowRight } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { isSmartCallback } from "../lib/smart/callback";
import { SmartCallback } from "./SmartCallback";

export function Home() {
  if (isSmartCallback()) return <SmartCallback />;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Stack spacing={1}>
            <Typography variant="h2">Patient-friendly health records</Typography>
            <Typography color="text.secondary">
              Connect one or more SMART portals, fetch FHIR resources directly in the browser, and organize records
              before sharing referral context.
            </Typography>
          </Stack>
          <Button component={RouterLink} to="/providers" variant="contained" endIcon={<ArrowRight size={18} />}>
            Add portal
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
