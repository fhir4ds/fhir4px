import { Route, Routes } from "react-router-dom";
import { ConnectedProvider } from "../pages/ConnectedProvider";
import { GroupingReport } from "../pages/GroupingReport";
import { Home } from "../pages/Home";
import { LocalExport } from "../pages/LocalExport";
import { LlmPlayground } from "../pages/LlmPlayground";
import { PatientExplorer } from "../pages/PatientExplorer";
import { ProviderSearch } from "../pages/ProviderSearch";
import { ReferralBuilder } from "../pages/ReferralBuilder";
import { Settings } from "../pages/Settings";
import { SmartCallback } from "../pages/SmartCallback";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/providers" element={<ProviderSearch />} />
      <Route path="/smart/callback" element={<SmartCallback />} />
      <Route path="/connected" element={<ConnectedProvider />} />
      <Route path="/records" element={<PatientExplorer />} />
      <Route path="/referral" element={<ReferralBuilder />} />
      <Route path="/export" element={<LocalExport />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/grouping-report" element={<GroupingReport />} />
      <Route path="/llm-playground" element={<LlmPlayground />} />
    </Routes>
  );
}
