/**
 * US Core data-presence table — one row per check, shown from the
 * connection menu. Profile enforcement is off; each row reports how many of
 * the records carry the elements the US Core profile requires.
 */

import { Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import type { UsCoreCheckResult } from "../lib/fhir/uscore-checks";
import { US_CORE_PASS_SHARE } from "../lib/fhir/uscore-summary";

function conformanceChip(result: UsCoreCheckResult) {
  if (result.error) return <Chip size="small" color="error" label="error" />;
  const total = result.total;
  const conforming = result.conforming;
  if (total === 0) return <Chip size="small" variant="outlined" label="no data" />;
  const share = conforming / total;
  return (
    <Chip
      size="small"
      color={share >= US_CORE_PASS_SHARE ? "success" : share >= 0.9 ? "warning" : "error"}
      label={`${conforming}/${total} (${Math.round(share * 100)}%)`}
    />
  );
}

export default function UsCoreDataTable({ checks }: { checks: UsCoreCheckResult[] }) {
  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        Profile enforcement off — fhir4ds ViewDefinitions report required-element presence per resource type.
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Check</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Requirement</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Conforming</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {checks.map((result) => (
            <TableRow key={result.check.id}>
              <TableCell>{result.check.name}</TableCell>
              <TableCell color="text.secondary">{result.error ?? result.check.description}</TableCell>
              <TableCell>{conformanceChip(result)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
}
