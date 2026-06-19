import { Route, Routes } from "react-router-dom";
import { ConnectedProvider } from "../pages/ConnectedProvider";
import { Docs } from "../pages/Docs";
import { GroupingReport } from "../pages/GroupingReport";
import { Landing } from "../pages/Landing";
import { LocalExport } from "../pages/LocalExport";
import { LlmPlayground } from "../pages/LlmPlayground";
import { PatientExplorer } from "../pages/PatientExplorer";
import { Privacy } from "../pages/Privacy";
import { ProviderSearch } from "../pages/ProviderSearch";
import { ReferralBuilder } from "../pages/ReferralBuilder";
import { Settings } from "../pages/Settings";
import { SmartCallback } from "../pages/SmartCallback";
import { Terms } from "../pages/Terms";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/providers" element={<ProviderSearch />} />
      <Route path="/smart/callback" element={<SmartCallback />} />
      <Route path="/connected" element={<ConnectedProvider />} />
      <Route path="/records" element={<PatientExplorer />} />
      <Route path="/summary" element={<PatientExplorer />} />
      <Route path="/referral" element={<ReferralBuilder />} />
      <Route path="/export" element={<LocalExport />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/grouping-report" element={<GroupingReport />} />
      <Route path="/llm-playground" element={<LlmPlayground />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
    </Routes>
  );
}
