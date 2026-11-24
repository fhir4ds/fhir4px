import { Box, Button, Container, IconButton, Stack, Typography } from "@mui/material";
import { Database, FlaskConical, Menu, Settings } from "lucide-react";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";
import {
  dispatchSmartAuthPopupEvent,
  isSmartAuthPopupMessage,
  type SmartAuthPopupMessage
} from "../../lib/smart/popup";
import { SMART_AUTH_CHANNEL } from "../../lib/smart/transient-state";
import { preloadEmbedder } from "../../lib/embeddings/embedder";
import { loadShard } from "../../lib/fhir/patient-friendly-lookup";
import { preloadAssociations } from "../../lib/associations/bundle";
import AppNavDrawer from "../AppNavDrawer";

const RECORDS_PATH = "/records";

/**
 * Opens the slide-out navigation. The Records page places its own menu
 * button inside its card header, so it reaches the app frame's drawer
 * through this context. Pages rendered outside the frame get a no-op.
 */
const OpenNavDrawerContext = createContext<() => void>(() => {});

export function useOpenNavDrawer(): () => void {
  return useContext(OpenNavDrawerContext);
}
import ConnectionPill from "../ConnectionPill";

// Top-bar destinations are the tools that apply across the product. The
// product pages themselves (Records, Quality, Cohorts, Providers) live in
// the two-level slide-out opened by the menu button.
const navItems = [
  { to: "/export", label: "Export", icon: <Database size={18} /> },
  { to: "/llm-playground", label: "LLM Lab", icon: <FlaskConical size={18} /> },
  { to: "/settings", label: "Settings", icon: <Settings size={18} /> }
];

export function AppFrame({ children }: PropsWithChildren) {
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);

  // Preload embedding model eagerly (needed for classification) and patient-
  // friendly lookup tables lazily (needed for deterministic naming). The model
  // loads immediately so it's ready when classification runs. JSON shards load
  // one at a time via requestIdleCallback to avoid CPU contention with WebGPU
  // inference during classification.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void preloadEmbedder().catch(() => {});
    }, 250);

    const shardSystems = ["snomed", "loinc", "icd10cm", "rxnorm", "cvx", "cpt", "hcpcs", "icd10pcs"] as const;
    const scheduleNext = (index: number) => {
      if (index >= shardSystems.length) return;
      const run = () => {
        void loadShard(shardSystems[index]).catch(() => {});
        scheduleNext(index + 1);
      };
      const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
      if (typeof idle === "function") {
        idle(run);
      } else {
        window.setTimeout(run, 10000 + index * 3000);
      }
    };
    scheduleNext(0);

    const assocIdle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    const preloadAssoc = () => void preloadAssociations().catch(() => {});
    if (typeof assocIdle === "function") {
      assocIdle(preloadAssoc);
    } else {
      window.setTimeout(preloadAssoc, 12000);
    }

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleMessage = (message: SmartAuthPopupMessage) => {
      dispatchSmartAuthPopupEvent(message);
      if (message.type === "fhir4px.smartAuth.complete" && location.pathname !== "/records") {
        navigate("/records");
      }
    };

    const handleWindowMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isSmartAuthPopupMessage(event.data)) return;
      handleMessage(event.data);
    };

    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(SMART_AUTH_CHANNEL);
      channel.onmessage = (event) => {
        if (isSmartAuthPopupMessage(event.data)) handleMessage(event.data);
      };
    }

    window.addEventListener("message", handleWindowMessage);
    return () => {
      window.removeEventListener("message", handleWindowMessage);
      channel?.close();
    };
  }, [location.pathname, navigate]);

  // On Records the page's card header carries the menu button and the
  // connection chip, so the top bar leaves both out there.
  const onRecords = location.pathname === RECORDS_PATH;
  const openNavDrawer = () => setNavOpen(true);

  return (
    <OpenNavDrawerContext.Provider value={openNavDrawer}>
    <Box minHeight="100vh" sx={{ background: "linear-gradient(180deg, #0d1b2a 0%, #09131e 100%)" }}>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }} mb={3}>
          <Typography
            component={RouterLink}
            to="/providers"
            variant="h1"
            sx={{ color: "text.primary", textDecoration: "none", flexGrow: 1 }}
          >
            fhir4px
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            {!onRecords && (
              <IconButton
                size="small"
                aria-label="Open navigation"
                aria-expanded={navOpen ? "true" : undefined}
                onClick={openNavDrawer}
              >
                <Menu size={20} />
              </IconButton>
            )}
            {navItems.map((item) => (
              <Button
                key={item.to}
                component={RouterLink}
                to={item.to}
                startIcon={item.icon}
                variant={location.pathname === item.to ? "contained" : "outlined"}
                size="small"
              >
                {item.label}
              </Button>
            ))}
            {!onRecords && <ConnectionPill />}
          </Stack>
        </Stack>
        {children}
      </Container>
      <AppNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
    </Box>
    </OpenNavDrawerContext.Provider>
  );
}
