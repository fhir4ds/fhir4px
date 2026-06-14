export type Vendor = "epic" | "cerner" | "unknown";

export interface SmartProvider {
  id: string;
  name: string;
  vendor: Vendor;
  fhirBaseUrl: string;
  clientId: string;
  redirectUriOverride?: string;
  scopes?: string;
  customAuthorizeEndpoint?: string;
  localTestPatientId?: string;
  localTestPatients?: SmartSandboxPatient[];
  launchMode?: "smart" | "local-test-session";
}

export interface SmartSandboxPatient {
  id: string;
  label: string;
  description?: string;
  source?: "configured" | "server";
}

export interface SmartEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

export interface SmartSessionInfo {
  fhirBaseUrl: string;
  vendor: Vendor;
  clientId: string;
  requestedScopes?: string;
  providerId?: string;
  providerName?: string;
}

export interface SmartToken {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType: string;
  expiresAt: number;
  patientId: string | null;
  scope: string;
}

export interface SmartTransientState {
  codeVerifier: string;
  state: string;
  fhirBaseUrl: string;
  vendor: Vendor;
  clientId: string;
  providerId?: string;
  providerName?: string;
  tokenEndpoint: string;
  redirectUri: string;
  requestedScopes?: string;
  expiresAt: number;
  popupLaunch?: boolean;
}

export interface SmartCallbackResult {
  token: SmartToken;
  session: SmartSessionInfo;
  popupLaunch?: boolean;
}

export class SmartAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartAuthError";
  }
}
