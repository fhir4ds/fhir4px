import { CERNER_SANDBOX_SCOPES, EPIC_SANDBOX_SCOPES, EXPANDED_CLINICAL_SCOPES } from "./scopes";
import type { SmartProvider, Vendor } from "./types";

const EPIC_SANDBOX_BASE_URL =
  import.meta.env.VITE_EPIC_SANDBOX_BASE_URL ||
  "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4";

const EPIC_SANDBOX_REDIRECT_URI =
  import.meta.env.VITE_EPIC_SANDBOX_REDIRECT_URI ||
  (import.meta.env.DEV ? "http://localhost:3000" : undefined);

const CERNER_SANDBOX_BASE_URL =
  import.meta.env.VITE_CERNER_SANDBOX_BASE_URL ||
  "https://fhir-myrecord.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d";

const SMART_DEV_SANDBOX_BASE_URL =
  import.meta.env.VITE_SMART_DEV_SANDBOX_BASE_URL ||
  "http://localhost:4004/hapi-fhir-jpaserver/fhir";

/**
 * Production client IDs per vendor. Directory providers from a given vendor
 * use this ID at SMART launch. Empty string means "not yet registered" -- the
 * provider will fail the launchability check in ProviderSearch until an ID
 * is provided via env var.
 *
 * Sandbox providers don't use this; they have their own sandbox-specific IDs
 * because each vendor's sandbox is a separate app registration.
 */
export function getProductionClientIdForVendor(vendor: Vendor): string {
  switch (vendor) {
    case "epic":
      return import.meta.env.VITE_EPIC_PROD_CLIENT_ID || "";
    case "cerner":
      return import.meta.env.VITE_CERNER_PROD_CLIENT_ID || "";
    default:
      return "";
  }
}

export function getSandboxProviders(): SmartProvider[] {
  return [
    {
      id: "epic-sandbox",
      name: "Epic Sandbox",
      vendor: "epic",
      fhirBaseUrl: EPIC_SANDBOX_BASE_URL,
      clientId: import.meta.env.VITE_EPIC_SANDBOX_CLIENT_ID || "",
      redirectUriOverride: EPIC_SANDBOX_REDIRECT_URI,
      scopes: EPIC_SANDBOX_SCOPES,
      customAuthorizeEndpoint: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize"
    },
    {
      id: "cerner-sandbox",
      name: "Cerner Sandbox",
      vendor: "cerner",
      fhirBaseUrl: CERNER_SANDBOX_BASE_URL,
      clientId: import.meta.env.VITE_CERNER_SANDBOX_CLIENT_ID || "",
      scopes: CERNER_SANDBOX_SCOPES
    },
    {
      id: "smart-dev-sandbox",
      name: "SMART Dev Sandbox",
      vendor: "unknown",
      fhirBaseUrl: SMART_DEV_SANDBOX_BASE_URL,
      clientId: "local-test-session",
      scopes: EXPANDED_CLINICAL_SCOPES,
      localTestPatientId: "fhir4px-sandbox-patient",
      localTestPatients: [
        {
          id: "fhir4px-sandbox-patient",
          label: "Pat Explorer",
          description: "Compact patient-explorer fixture",
          source: "configured"
        },
        {
          id: "fhir4px-large-sandbox-patient",
          label: "Jordan Longitudinal",
          description: "Large synthetic patient with repeated labs, vitals, and medications",
          source: "configured"
        },
        {
          id: "fhir4px-large-cardiorenal-patient",
          label: "Riley Cardiorenal",
          description: "Large synthetic patient with heart failure, anticoagulation, kidney disease, and metabolic monitoring",
          source: "configured"
        },
        {
          id: "fhir4px-large-respiratory-immune-patient",
          label: "Morgan Respiratory-Immune",
          description: "Large synthetic patient with respiratory, HIV, thyroid, anemia, and medication safety monitoring",
          source: "configured"
        }
      ],
      launchMode: "local-test-session"
    }
  ];
}

export function getProviderById(id: string): SmartProvider | undefined {
  return getSandboxProviders().find((provider) => provider.id === id);
}
