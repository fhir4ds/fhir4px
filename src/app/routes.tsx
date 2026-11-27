import { useEffect, useState } from "react";
import { matchPath, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { ConnectedProvider } from "../pages/ConnectedProvider";
import { Docs } from "../pages/Docs";
import { GroupingReport } from "../pages/GroupingReport";
import { Landing } from "../pages/Landing";
import { LocalExport } from "../pages/LocalExport";
import { LlmPlayground } from "../pages/LlmPlayground";
import { PatientExplorer } from "../pages/PatientExplorer";
import QualityPage from "../pages/Quality";
import CohortsPage from "../pages/Cohorts";
import { Privacy } from "../pages/Privacy";
import { ProviderSearch } from "../pages/ProviderSearch";
import { ReferralBuilder } from "../pages/ReferralBuilder";
import { SmartCallback } from "../pages/SmartCallback";
import { Terms } from "../pages/Terms";

/**
 * Keep-alive wrapper for expensive pages: the page mounts on first visit and
 * stays mounted (hidden) when the route is inactive, so switching between
 * Records ↔ Quality preserves all calculated state. `display: contents`
 * keeps the wrapper transparent to layout while active.
 */
function KeepAlive({ paths, children }: { paths: string[]; children: ReactNode }) {
  const location = useLocation();
  const active = paths.some((path) => matchPath(path, location.pathname) !== null);
  const [everActive, setEverActive] = useState(false);
  useEffect(() => {
    if (active) setEverActive(true);
  }, [active]);
  if (!everActive) return null;
  return <div style={{ display: active ? "contents" : "none" }}>{children}</div>;
}

export function AppRoutes() {
  return (
    <>
      <KeepAlive paths={["/records"]}>
        <PatientExplorer />
      </KeepAlive>
      <KeepAlive paths={["/quality"]}>
        <QualityPage />
      </KeepAlive>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/providers" element={<ProviderSearch />} />
        <Route path="/smart/callback" element={<SmartCallback />} />
        <Route path="/connected" element={<ConnectedProvider />} />
        <Route path="/cohorts" element={<CohortsPage />} />
        <Route path="/referral" element={<ReferralBuilder />} />
        <Route path="/export" element={<LocalExport />} />
        <Route path="/grouping-report" element={<GroupingReport />} />
        <Route path="/llm-playground" element={<LlmPlayground />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
    </>
  );
}
