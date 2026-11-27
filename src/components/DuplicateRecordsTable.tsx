/**
 * Duplicate groups found by fhir4ds deduplication — one row per group: the
 * record that is shown, and how many copies of it were dropped where.
 */

import { Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import type { DuplicateGroup, DuplicateSummary } from "../lib/fhir/dedupe";
import { recordDateLabel } from "../lib/fhir/display-date";

function portalsOf(group: DuplicateGroup): string {
  const names = new Set(
    [group.kept, ...group.copies].map((record) => record.portalSourceName ?? record.portalSourceId ?? "Unknown")
  );
  return [...names].join(", ");
}

export default function DuplicateRecordsTable({ summary }: { summary: DuplicateSummary }) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        fhir4ds keeps one record per group and hides the others as copies. The check runs in the background after the
        records appear; records you added yourself are not part of it.
      </Typography>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {summary.byType.map((entry) => (
          <Chip key={entry.resourceType} size="small" variant="outlined" label={`${entry.resourceType} · ${entry.copies}`} />
        ))}
      </Stack>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Kept</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Value</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Copies</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Portals</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {summary.groups.map((group) => (
            <TableRow key={group.kept.id}>
              <TableCell sx={{ overflowWrap: "anywhere" }}>{group.kept.sourceLabel}</TableCell>
              <TableCell>{group.kept.resourceType}</TableCell>
              <TableCell>{group.kept.date || group.kept.latestDate ? recordDateLabel(group.kept) : "—"}</TableCell>
              <TableCell>{group.kept.displayValue ?? "—"}</TableCell>
              <TableCell>{group.copies.length}</TableCell>
              <TableCell sx={{ overflowWrap: "anywhere" }}>{portalsOf(group)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
}
