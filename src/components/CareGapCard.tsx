/**
 * One care gap as a card. A click on the body shows the evidence; the
 * buttons open the gap's records and dismiss it. Shared by the Records
 * summary band (as a carousel) and the Quality area's Care gaps view.
 */

import { Box, Card, CardContent, Chip, IconButton, Stack, Tooltip, Typography, useTheme } from "@mui/material";
import { AlarmClockOff, CalendarClock, ExternalLink, X } from "lucide-react";
import type { CareGap, CareGapSeverity } from "../lib/fhir/care-gaps";

export const CARE_GAP_SEVERITY_COLOR: Record<CareGapSeverity, "error" | "warning"> = {
  high: "error",
  moderate: "warning"
};

export const CARE_GAP_SOURCE_LABEL: Record<CareGap["source"], string> = {
  immunization: "CDC schedule",
  measure: "CMS measure"
};

interface CareGapCardProps {
  gap: CareGap;
  expanded: boolean;
  onToggleExpanded: (gap: CareGap) => void;
  /** Set together with onSelect: the button's label, e.g. "View records". */
  selectLabel?: string;
  onSelect?: (gap: CareGap) => void;
  onDismiss?: (gap: CareGap) => void;
}

export default function CareGapCard({ gap, expanded, onToggleExpanded, selectLabel, onSelect, onDismiss }: CareGapCardProps) {
  const theme = useTheme();
  return (
    <Card
      variant="outlined"
      onClick={() => onToggleExpanded(gap)}
      sx={{
        minWidth: 0,
        cursor: "pointer",
        borderColor: gap.severity === "high" ? "error.light" : "warning.light",
        "&:hover": { borderColor: gap.severity === "high" ? "error.main" : "warning.main" }
      }}
    >
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
          {gap.severity === "high" ? (
            <AlarmClockOff size={16} color={theme.palette.error.main} />
          ) : (
            <CalendarClock size={16} color={theme.palette.warning.main} />
          )}
          <Chip
            size="small"
            color={CARE_GAP_SEVERITY_COLOR[gap.severity]}
            variant="outlined"
            label={gap.severity === "high" ? "Overdue" : "Due"}
          />
          <Chip size="small" variant="outlined" label={CARE_GAP_SOURCE_LABEL[gap.source]} />
          <Box onClick={(event) => event.stopPropagation()} sx={{ ml: "auto" }}>
            <Stack direction="row" spacing={0.25}>
              {selectLabel && onSelect && (
                <Tooltip title={selectLabel}>
                  <IconButton size="small" aria-label={`${selectLabel} for ${gap.title}`} onClick={() => onSelect(gap)}>
                    <ExternalLink size={14} />
                  </IconButton>
                </Tooltip>
              )}
              {onDismiss && (
                <Tooltip title="Dismiss">
                  <IconButton size="small" aria-label={`Dismiss ${gap.title}`} onClick={() => onDismiss(gap)}>
                    <X size={14} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Box>
        </Stack>
        <Typography fontWeight={700} sx={{ mt: 0.75, overflowWrap: "anywhere" }}>
          {gap.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {gap.summary}
        </Typography>
        {expanded && gap.details.length > 0 && (
          <Stack spacing={0.25} sx={{ mt: 1 }}>
            {gap.details.map((detail, index) => (
              <Typography key={index} variant="caption" color="text.secondary">
                • {detail}
              </Typography>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
