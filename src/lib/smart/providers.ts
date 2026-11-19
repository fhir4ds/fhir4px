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
      customAuthorizeEndpoint: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize",
      customTokenEndpoint: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"
    },
    {
      id: "cerner-sandbox",
      name: "Cerner Sandbox",
      vendor: "cerner",
      fhirBaseUrl: CERNER_SANDBOX_BASE_URL,
      clientId: import.meta.env.VITE_CERNER_SANDBOX_CLIENT_ID || "",
      scopes: CERNER_SANDBOX_SCOPES
    },
    // SMART Dev Sandbox hits a local HAPI FHIR server and uses local test
    // fixtures, so it's only useful when running the dev sandbox locally.
    // Hide it from production builds.
    ...(import.meta.env.DEV
      ? [
          {
            id: "smart-dev-sandbox",
            name: "SMART Dev Sandbox",
            vendor: "unknown" as const,
            fhirBaseUrl: SMART_DEV_SANDBOX_BASE_URL,
            clientId: "local-test-session",
            scopes: EXPANDED_CLINICAL_SCOPES,
            localTestPatientId: "fhir4px-sandbox-patient",
            localTestPatients: [
              {
                id: "fhir4px-sandbox-patient",
                label: "Pat Explorer",
                description: "Compact patient-explorer fixture",
                source: "configured" as const
              },
              {
                id: "fhir4px-large-sandbox-patient",
                label: "Jordan Longitudinal",
                description: "Large synthetic patient with repeated labs, vitals, and medications",
                source: "configured" as const
              },
              {
                id: "fhir4px-large-cardiorenal-patient",
                label: "Riley Cardiorenal",
                description:
                  "Large synthetic patient with heart failure, anticoagulation, kidney disease, and metabolic monitoring",
                source: "configured" as const
              },
              {
                id: "fhir4px-large-respiratory-immune-patient",
                label: "Morgan Respiratory-Immune",
                description:
                  "Large synthetic patient with respiratory, HIV, thyroid, anemia, and medication safety monitoring",
                source: "configured" as const
              },
              {
                id: "fhir4px-tier2-codes-patient",
                label: "Sam Codes-Only (Tier 2)",
                description: "Tests deterministic lookup: standard LOINC/RxNorm/SNOMED codes, condition-lab pairs in deterministic table",
                source: "configured" as const
              },
              {
                id: "fhir4px-tier3-miscoded-patient",
                label: "Alex Miscoded (Tier 3)",
                description: "Tests embedding classification: vital signs miscategorized as labs, labs miscategorized as vitals",
                source: "configured" as const
              },
              {
                id: "fhir4px-tier4-nocodes-patient",
                label: "Robin No-Codes (Tier 4)",
                description: "Tests LLM naming: records with display text only, no standard codes — LLM must generate patient-friendly names",
                source: "configured" as const
              },
              {
                id: "fhir4px-tier2-relations-patient",
                label: "Jordan Linked (Relationships)",
                description: "Tests deterministic relationships: HbA1c/Glucose→Diabetes, BP→HTN, Metformin→Diabetes, Lisinopril→HTN, Albuterol→Asthma",
                source: "configured" as const
              },
              {
                id: "epic-e898f60a386335c3402baac8",
                label: "Camila Lopez (Epic)",
                description: "Epic non-prod sandbox test patient, pulled via SMART (female, 1987; labs, visits, reports)",
                source: "configured" as const
              },
              {
                id: "epic-f95f96a568cf431d76cfb4af",
                label: "Derrick Lin (Epic)",
                description: "Epic non-prod sandbox test patient, pulled via SMART (male, 1973; ~1600 observations)",
                source: "configured" as const
              },
              {
                id: "epic-9812977b3bdcc25fd203339c",
                label: "Desiree Powell (Epic)",
                description: "Epic non-prod sandbox test patient, pulled via SMART (female, 2014 — pediatric; 629 observations, 7 immunizations)",
                source: "configured" as const
              },
              {
                id: "epic-4bd1549e881bc26fc9cfa21b",
                label: "Elijah Davis (Epic)",
                description: "Epic non-prod sandbox test patient, pulled via SMART (male, 1993; conditions, allergies, smoking history)",
                source: "configured" as const
              },
              {
                id: "epic-d0d4a9c9b56d243d2c3d94b3",
                label: "Linda Ross (Epic)",
                description: "Epic non-prod sandbox test patient, pulled via SMART (female, 1969; vitals, conditions, medications)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-abi-adolescent",
                label: "Abi Turner (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 2010-08-15; 130 observations, 3 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-benji-bipolar",
                label: "Benji Achebe (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1984-10-02; 286 observations, 3 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-carl-copd",
                label: "Carl Whitehorse (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1961-12-03; 259 observations, 6 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-carmen-breast-cancer",
                label: "Carmen Tuiasosopo (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1963-01-22; 324 observations, 5 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-chase-crohn",
                label: "Chase Whitaker (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1996-02-28; 341 observations, 4 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-ciro-cirrhosis",
                label: "Ciro Esposito (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1965-08-08; 412 observations, 6 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-danielle-esrd",
                label: "Danielle Washington (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1954-10-19; 1134 observations, 14 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-elena-epilepsy",
                label: "Elena Moreno (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 2001-09-07; 205 observations, 3 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-frank-post-mi",
                label: "Frank Kowalski (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1964-09-14; 318 observations, 7 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-grace-stroke",
                label: "Grace Mensah (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1957-02-28; 205 observations, 8 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-gus-gout",
                label: "Gus Guerrero (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1967-07-09; 213 observations, 6 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-hank-hfref",
                label: "Hank Brennan (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1958-07-04; 329 observations, 9 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-izzy-hiv",
                label: "Izzy Osei (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1979-04-27; 514 observations, 3 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-lucia-sle",
                label: "Lucia Ramirez (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1993-08-25; 801 observations, 9 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-mabel-atopic-asthma",
                label: "Mabel Okafor (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1991-06-30; 129 observations, 4 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-maya-mdd",
                label: "Maya Chen (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1989-11-13; 183 observations, 4 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-olive-osteoporosis",
                label: "Olive Petrov (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1946-03-11; 264 observations, 7 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-omar-metabolic",
                label: "Omar Haddad (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1980-05-30; 222 observations, 6 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-pete-psoriasis",
                label: "Pete Nguyen (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1985-03-25; 175 observations, 3 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-raul-severe-eosinophilic-asthma",
                label: "Raul Delgado (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1973-11-22; 879 observations, 10 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-rosa-ra",
                label: "Rosa Faleao (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1970-06-14; 254 observations, 4 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-sam-schizophrenia",
                label: "Sam Bhatt (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1981-03-25; 349 observations, 5 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-shirley-severe-copd",
                label: "Shirley Doyle (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1955-04-17; 661 observations, 9 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-simi-sickle",
                label: "Simi Adesanya (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1999-05-19; 333 observations, 7 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-tessa-t1d",
                label: "Tessa Lindqvist (Chronic)",
                description: "Chronic-cohort synthetic patient (female, 1998-12-05; 414 observations, 4 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-tony-transplant",
                label: "Tony Vargas (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1966-01-08; 371 observations, 7 conditions)",
                source: "configured" as const
              },
              {
                id: "fhir4px-chronic-walt-multimorbid",
                label: "Walt Jorgensen (Chronic)",
                description: "Chronic-cohort synthetic patient (male, 1944-02-09; 774 observations, 16 conditions)",
                source: "configured" as const
              }
            ],
            launchMode: "local-test-session" as const
          }
        ]
      : [])
  ];
}

export function getProviderById(id: string): SmartProvider | undefined {
  return getSandboxProviders().find((provider) => provider.id === id);
}
