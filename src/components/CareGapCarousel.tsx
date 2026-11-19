/**
 * Care-gap carousel for the Patient Summary band. Shows up to a few gaps
 * at a time (3 on md+, 1 on xs) with paging arrows and dots. Card body
 * click toggles evidence expansion; the inline "View" button deep-links
 * to the gap's target tab via onSelect.
 */

import { useState } from "react";
import { Box, Card, CardContent, Chip, IconButton, Skeleton, Stack, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { AlarmClockOff, CalendarClock, ChevronLeft, ChevronRight, ExternalLink, RotateCcw, X } from "lucide-react";
import type { CareGap, CareGapSeverity } from "../lib/fhir/care-gaps";

const SEVERITY_COLOR: Record<CareGapSeverity, "error" | "warning"> = {
  high: "error",
  moderate: "warning"
};

const SOURCE_LABEL: Record<CareGap["source"], string> = {
  immunization: "CDC schedule",
  measure: "CMS measure"
};

interface CareGapCarouselProps {
  gaps: CareGap[];
  busy?: boolean;
  onSelect?: (gap: CareGap) => void;
  dismissed?: CareGap[];
  onDismiss?: (gap: CareGap) => void;
  onRestore?: (gap: CareGap) => void;
}

export default function CareGapCarousel({ gaps, busy = false, onSelect, dismissed = [], onDismiss, onRestore }: CareGapCarouselProps) {
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up("md"));
  const perView = isWide ? 3 : 1;
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (busy && gaps.length === 0) {
    return (
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
        {[0, 1, 2].map((key) => (
          <Card key={key} variant="outlined" sx={{ minWidth: 0 }}>
            <CardContent>
              <Skeleton variant="text" width="60%" />
              <Skeleton variant="text" width="90%" />
              <Skeleton variant="text" width="40%" />
            </CardContent>
          </Card>
        ))}
      </Box>
    );
  }
  if (gaps.length === 0) return null;

  const pageCount = Math.max(1, Math.ceil(gaps.length / perView));
  const safePage = Math.min(page, pageCount - 1);
  const visible = gaps.slice(safePage * perView, safePage * perView + perView);

  return (
    <Stack spacing={0.75} alignItems="center">
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5, width: "100%" }}>
        {visible.map((gap) => {
          const expanded = expandedId === gap.id;
          return (
            <Card
              key={gap.id}
              variant="outlined"
              onClick={() => setExpandedId(expanded ? null : gap.id)}
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
                  <Chip size="small" color={SEVERITY_COLOR[gap.severity]} variant="outlined" label={gap.severity === "high" ? "Overdue" : "Due"} />
                  <Chip size="small" variant="outlined" label={SOURCE_LABEL[gap.source]} />
                  <Box onClick={(event) => event.stopPropagation()} sx={{ ml: "auto" }}>
                    <Stack direction="row" spacing={0.25}>
                      {gap.targetTab && onSelect && (
                        <Tooltip title="View records">
                          <IconButton
                            size="small"
                            aria-label={`View records for ${gap.title}`}
                            onClick={() => onSelect(gap)}
                          >
                            <ExternalLink size={14} />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onDismiss && (
                        <Tooltip title="Dismiss">
                          <IconButton
                            size="small"
                            aria-label={`Dismiss ${gap.title}`}
                            onClick={() => onDismiss(gap)}
                          >
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
        })}
        {visible.length < 3 && isWide &&
          Array.from({ length: 3 - visible.length }, (_, fillerIndex) => <Box key={`filler-${fillerIndex}`} />)}
      </Box>
      {dismissed.length > 0 && (
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="caption" color="text.secondary">
            Dismissed:
          </Typography>
          {dismissed.map((gap) => (
            <Chip
              key={gap.id}
              size="small"
              variant="outlined"
              label={gap.title}
              deleteIcon={<RotateCcw size={12} />}
              onDelete={() => onRestore?.(gap)}
              onClick={() => onRestore?.(gap)}
            />
          ))}
        </Stack>
      )}
      {pageCount > 1 && (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <IconButton size="small" aria-label="Previous care gaps" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            <ChevronLeft size={16} />
          </IconButton>
          {Array.from({ length: pageCount }, (_, dotIndex) => (
            <Box
              key={dotIndex}
              onClick={() => setPage(dotIndex)}
              sx={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                cursor: "pointer",
                bgcolor: dotIndex === safePage ? "primary.main" : "action.disabled",
                opacity: dotIndex === safePage ? 1 : 0.4
              }}
            />
          ))}
          <IconButton size="small" aria-label="Next care gaps" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
            <ChevronRight size={16} />
          </IconButton>
        </Stack>
      )}
    </Stack>
  );
}
