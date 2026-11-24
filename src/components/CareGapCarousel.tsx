/**
 * Care-gap carousel for the Records summary band. Shows a few gaps at a time
 * (3 on md+, 1 on xs) with paging arrows and dots. The cards themselves are
 * CareGapCard, shared with the Quality area's Care gaps view.
 */

import { useState } from "react";
import { Box, Card, CardContent, Chip, IconButton, Skeleton, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import type { CareGap } from "../lib/fhir/care-gaps";
import CareGapCard from "./CareGapCard";

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
        {visible.map((gap) => (
          <CareGapCard
            key={gap.id}
            gap={gap}
            expanded={expandedId === gap.id}
            onToggleExpanded={(toggled) => setExpandedId((current) => (current === toggled.id ? null : toggled.id))}
            selectLabel={gap.targetTab ? "View records" : undefined}
            onSelect={onSelect}
            onDismiss={onDismiss}
          />
        ))}
        {visible.length < 3 && isWide &&
          Array.from({ length: 3 - visible.length }, (_, fillerIndex) => <Box key={`filler-${fillerIndex}`} />)}
      </Box>
      {dismissed.length > 0 && (
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ alignSelf: "stretch" }}>
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
