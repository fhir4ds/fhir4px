import { Box, Container } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, type PropsWithChildren } from "react";
import {
  dispatchSmartAuthPopupEvent,
  isSmartAuthPopupMessage,
  type SmartAuthPopupMessage
} from "../../lib/smart/popup";
import { SMART_AUTH_CHANNEL } from "../../lib/smart/transient-state";
import { preloadEmbedder } from "../../lib/embeddings/embedder";
import { loadShard } from "../../lib/fhir/patient-friendly-lookup";
import { preloadAssociations } from "../../lib/associations/bundle";
import { publishConnections, publishPatient } from "../../lib/app/connection-status";
import { headerPatientFor } from "../../lib/fhir/patient-header";
import { getSourceDataset, listConnectedSources, providerLabel, sourceLabel } from "../../lib/smart/sources";
import { getOrCreateSessionVaultKey } from "../../lib/vault/keys";
import AppHeader from "../AppHeader";
import AppNav from "../AppNav";

// Site pages: public text pages whose content is loose (not inside a bordered
// card). The side navigation switches between parts of a loaded patient's
// record, so it has no job here, and its border would have nothing to line
// up with.
const SITE_PATHS: ReadonlySet<string> = new Set(["/", "/docs", "/terms", "/privacy"]);

export function AppFrame({ children }: PropsWithChildren) {
  const location = useLocation();
  const navigate = useNavigate();
  const isSitePage = SITE_PATHS.has(location.pathname);

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

  // The connection controls and the header patient read the status store,
  // which the Records page publishes. After a reload onto another page that
  // page has not run yet, so make the stored connections and their patients
  // known from the vault. Best-effort: a vault that cannot be read leaves the
  // controls showing no connection and the header without a patient.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const key = await getOrCreateSessionVaultKey();
      const connected = await listConnectedSources(key);
      if (cancelled) return;
      publishConnections(
        connected.map((source) => ({
          id: source.id,
          kind: source.kind,
          fileName: source.kind === "bundle" ? source.fileName : undefined,
          label: sourceLabel(source),
          providerLabel: providerLabel(source),
          status: source.status,
          recordCount: source.recordCount
        }))
      );
      // Each stored dataset holds its portal's Patient resource.
      const datasets = await Promise.all(connected.map((source) => getSourceDataset(key, source.id)));
      if (cancelled) return;
      publishPatient(headerPatientFor(datasets.flatMap((dataset) => (dataset?.patient ? [dataset.patient] : []))));
    })().catch(() => {
      console.warn("[fhir4px:connections] stored connections could not be read");
    });
    return () => {
      cancelled = true;
    };
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

  return (
    <Box
      minHeight="100vh"
      sx={{
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(180deg, #0d1b2a 0%, #09131e 100%)"
      }}
    >
      <AppHeader />
      {/* The body fills the rest of the viewport, so the side navigation
          stretches the full height of the page. */}
      <Container
        maxWidth="lg"
        sx={{ display: "flex", flexDirection: "row", alignItems: "stretch", flexGrow: 1, pt: 3, pb: 3 }}
      >
        {!isSitePage && <AppNav />}
        <Box sx={{ flexGrow: 1, minWidth: 0, ml: isSitePage ? 0 : 2 }}>{children}</Box>
      </Container>
    </Box>
  );
}
