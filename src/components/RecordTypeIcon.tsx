/**
 * Icon for a Records tab — a resource type, or the cross-domain Summary.
 * Shared by the Records page's own tab strip and the app frame's side
 * navigation so both draw the same glyphs.
 */

import type { ReactElement } from "react";
import {
  Activity,
  CalendarDays,
  FileText,
  HeartPulse,
  LayoutDashboard,
  Pill,
  ShieldAlert,
  Stethoscope,
  Syringe,
  type LucideIcon
} from "lucide-react";

export type ExplorerTab =
  | "PatientSummary"
  | "MedicationRequest"
  | "AllergyIntolerance"
  | "Condition"
  | "Observation"
  | "Immunization"
  | "Encounter"
  | "Procedure"
  | "DiagnosticReport"
  | "DocumentReference";

const ICONS = {
  PatientSummary: LayoutDashboard,
  MedicationRequest: Pill,
  AllergyIntolerance: ShieldAlert,
  Condition: HeartPulse,
  Observation: Activity,
  Immunization: Syringe,
  Encounter: CalendarDays,
  Procedure: Stethoscope,
  DiagnosticReport: FileText,
  DocumentReference: FileText
} as const satisfies Record<ExplorerTab, LucideIcon>;

/** Icon for a tab id; undefined for an id that is not a Records tab. */
export function recordTypeIcon(type: string, size = 20): ReactElement | undefined {
  const Icon = (ICONS as Partial<Record<string, LucideIcon>>)[type];
  return Icon ? <Icon size={size} /> : undefined;
}
