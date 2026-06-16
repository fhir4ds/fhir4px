import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Info,
  MapPin,
  Plus,
  Search,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { resolveDirectoryOrigin, searchProviders } from "../lib/directory/client";
import type { DirectoryOrigin, DirectoryProvider, DirectorySort } from "../lib/directory/types";
import { preloadNamingModel } from "../lib/llm/naming";
import { buildAuthorizeUrl } from "../lib/smart/oauth";
import { fetchSandboxPatients, configuredSandboxPatients, mergeSandboxPatients } from "../lib/smart/sandbox";
import { upsertLocalTestSource } from "../lib/smart/sources";
import { getOrCreateSessionVaultKey } from "../lib/vault/keys";

interface ProviderResultGroup {
  key: string;
  name: string;
  specialty?: string;
  npi?: string;
  location?: string;
  distanceMiles?: number | null;
  options: DirectoryProvider[];
}

function portalKey(provider: DirectoryProvider): string {
  if (provider.endpointStatus === "provider_only") return provider.id;
  const url = provider.fhirBaseUrl.trim().toLowerCase().replace(/\/+$/, "");
  const brand = (provider.accessBrand || provider.name).trim().toLowerCase();
  return provider.launchMode === "local-test-session" ? provider.id : `${url}|${brand}`;
}

function groupKey(provider: DirectoryProvider): string {
  return provider.npi ? `npi-${provider.npi}` : provider.id;
}

function recommendationLabel(provider: DirectoryProvider): string {
  if (provider.endpointStatus === "provider_only") return "Portal unknown";
  if (provider.launchMode === "local-test-session") return "Sandbox";
  if (provider.patientDisplayPolicy === "alternative_option") return "Other possible portal";
  if (provider.recommendationTier === "high_confidence_confirm") return "High confidence";
  if (provider.recommendationTier === "possible_confirm") return "Possible portal";
  return "Likely portal";
}

function recommendationColor(provider: DirectoryProvider): "default" | "primary" | "success" | "warning" | "info" {
  if (provider.endpointStatus === "provider_only") return "default";
  if (provider.launchMode === "local-test-session") return "info";
  if (provider.recommendationTier === "high_confidence_confirm") return "success";
  if (provider.patientDisplayPolicy === "alternative_option") return "warning";
  return "primary";
}

function canLaunch(provider: DirectoryProvider): boolean {
  if (provider.endpointStatus === "provider_only") return false;
  return provider.launchMode === "local-test-session" || Boolean(provider.clientId);
}

function portalDisplayName(provider: DirectoryProvider): string {
  if (provider.endpointStatus === "provider_only") return "Portal unknown";
  return provider.accessBrand || provider.name;
}

function sourcePathLabel(provider: DirectoryProvider): string {
  if (provider.endpointStatus === "provider_only") return "No endpoint match";
  if (provider.launchMode === "local-test-session") return "Sandbox";

  switch (provider.evidencePathClass || provider.matchMethod) {
    case "provider_org_npi_direct":
    case "npi_direct":
      return "NPI direct";
    case "reviewed_public_assertion":
    case "assisted_review_assertion":
    case "scrape_reviewed_assertion":
      return "Reviewed evidence";
    case "practice_location_endpoint":
    case "location_epic_child":
    case "location_cerner":
      return "Practice location";
    case "cleaned_provider_location_endpoint":
      return "Cleaned location";
    case "nppes_endpoint_reference":
      return "NPPES endpoint";
    case "cms_npd_direct_endpoint":
    case "cms_npd_practitioner_role_endpoint":
    case "cms_npd_organization_endpoint":
      return "CMS NPD endpoint";
    case "address_unique_plus_vector_endpoint":
      return "Address + retrieval";
    case "address_brand_supported_endpoint":
      return "Address + brand";
    case "address_unique_endpoint":
      return "Unique address";
    case "address_entity_endpoint":
      return "Address candidate";
    case "strict_vector_candidate":
      return "Vector candidate";
    default:
      return provider.evidencePathClass || provider.matchMethod || "Directory evidence";
  }
}

function compareOptions(left: DirectoryProvider, right: DirectoryProvider): number {
  if (left.endpointStatus === "provider_only" && right.endpointStatus !== "provider_only") return 1;
  if (right.endpointStatus === "provider_only" && left.endpointStatus !== "provider_only") return -1;
  const priority =
    (left.patientDisplayPriority ?? 99) - (right.patientDisplayPriority ?? 99) ||
    (left.candidateRank ?? 99) - (right.candidateRank ?? 99) ||
    (right.confidence ?? 0) - (left.confidence ?? 0);
  if (priority !== 0) return priority;
  return portalDisplayName(left).localeCompare(portalDisplayName(right));
}

function groupProviderResults(providers: DirectoryProvider[]): ProviderResultGroup[] {
  const groups = new Map<string, ProviderResultGroup>();
  for (const provider of providers) {
    const key = groupKey(provider);
    const existing = groups.get(key);
    if (existing) {
      existing.options.push(provider);
      existing.distanceMiles ??= provider.distanceMiles;
      continue;
    }

    groups.set(key, {
      key,
      name: provider.name,
      specialty: provider.specialty,
      npi: provider.npi,
      location: provider.location,
      distanceMiles: provider.distanceMiles,
      options: [provider]
    });
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    options: group.options.sort(compareOptions)
  }));
}

export function ProviderSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DirectorySort>("name");
  const [originText, setOriginText] = useState("");
  const [origin, setOrigin] = useState<DirectoryOrigin | null>(null);
  const [providers, setProviders] = useState<DirectoryProvider[]>([]);
  const [selectedPortals, setSelectedPortals] = useState<DirectoryProvider[]>([]);
  const [expandedOptions, setExpandedOptions] = useState<Record<string, boolean>>({});
  const [sandboxPatients, setSandboxPatients] = useState<Record<string, ReturnType<typeof configuredSandboxPatients>>>({});
  const [selectedSandboxPatients, setSelectedSandboxPatients] = useState<Record<string, string>>({});
  const [connectingProviderId, setConnectingProviderId] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const [connectionErrors, setConnectionErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => groupProviderResults(providers), [providers]);
  const selectedPortalKeys = useMemo(() => new Set(selectedPortals.map(portalKey)), [selectedPortals]);

  useEffect(() => {
    let cancelled = false;
    if (sort !== "distance" || !originText.trim()) {
      setOrigin(null);
      return () => {
        cancelled = true;
      };
    }

    void resolveDirectoryOrigin(originText).then((resolved) => {
      if (!cancelled) setOrigin(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [originText, sort]);

  useEffect(() => {
    let cancelled = false;
    void searchProviders(query, { sort, origin }).then((results) => {
      if (!cancelled) setProviders(results);
    });
    return () => {
      cancelled = true;
    };
  }, [query, sort, origin]);

  useEffect(() => {
    const sandboxProviders = providers.filter((provider) => provider.launchMode === "local-test-session");
    for (const provider of sandboxProviders) {
      const configured = configuredSandboxPatients(provider);
      setSandboxPatients((current) => ({
        ...current,
        [provider.id]: mergeSandboxPatients(configured, current[provider.id] ?? [])
      }));
      setSelectedSandboxPatients((current) => ({
        ...current,
        [provider.id]: current[provider.id] || provider.localTestPatientId || configured[0]?.id || ""
      }));

      void fetchSandboxPatients(provider)
        .then((discovered) => {
          setSandboxPatients((current) => ({
            ...current,
            [provider.id]: mergeSandboxPatients(configured, discovered)
          }));
        })
        .catch(() => {
          setSandboxPatients((current) => ({
            ...current,
            [provider.id]: mergeSandboxPatients(configured, current[provider.id] ?? [])
          }));
        });
    }
  }, [providers]);

  function selectedSandboxPatientId(provider: DirectoryProvider): string {
    return (
      selectedSandboxPatients[provider.id] ||
      provider.localTestPatientId ||
      sandboxPatients[provider.id]?.[0]?.id ||
      configuredSandboxPatients(provider)[0]?.id ||
      ""
    );
  }

  function describeConnectError(provider: DirectoryProvider, caught: unknown): string {
    const message = caught instanceof Error ? caught.message : "Could not start SMART launch";
    if (provider.launchMode !== "local-test-session") return message;
    if (!window.isSecureContext || !globalThis.crypto?.subtle) {
      return `${message}. Local sandbox records use encrypted browser storage, which requires Web Crypto on a secure origin. Use http://localhost:3000 on this computer, or serve the app over HTTPS for phone/Tailscale testing.`;
    }
    return message;
  }

  async function connect(provider: DirectoryProvider) {
    const providerKey = portalKey(provider);
    setError(null);
    setConnectionErrors((current) => {
      const next = { ...current };
      delete next[providerKey];
      return next;
    });
    setConnectStatus(provider.launchMode === "local-test-session" ? "Opening sandbox records..." : "Opening patient portal...");
    setConnectingProviderId(provider.id);
    let popup: Window | null = null;
    try {
      if (provider.launchMode === "local-test-session") {
        const selectedPatientId = selectedSandboxPatientId(provider);
        console.info("[fhir4px:provider]", {
          event: "sandbox-connect-start",
          timestamp: new Date().toISOString(),
          providerId: provider.id,
          patientId: selectedPatientId || null,
          origin: window.location.origin,
          isSecureContext: window.isSecureContext,
          hasCryptoSubtle: Boolean(globalThis.crypto?.subtle)
        });
        if (!selectedPatientId) throw new Error("Select a sandbox patient before opening the local test session");
        if (!window.isSecureContext || !globalThis.crypto?.subtle) {
          throw new Error("Browser storage encryption is unavailable");
        }
        const key = await getOrCreateSessionVaultKey();
        await upsertLocalTestSource(key, { ...provider, localTestPatientId: selectedPatientId });
        console.info("[fhir4px:provider]", {
          event: "sandbox-source-saved",
          timestamp: new Date().toISOString(),
          providerId: provider.id,
          patientId: selectedPatientId,
          nextRoute: "/records"
        });
        navigate("/records");
        window.setTimeout(() => void preloadNamingModel(), 0);
        return;
      }

      const redirectUri = provider.redirectUriOverride || window.location.origin;
      console.info("[fhir4px:provider]", {
        event: "smart-connect-start",
        timestamp: new Date().toISOString(),
        providerId: provider.id,
        providerName: provider.name,
        vendor: provider.vendor,
        fhirBaseUrl: provider.fhirBaseUrl,
        clientId: provider.clientId ? `${provider.clientId.slice(0, 8)}...` : "(empty)",
        redirectUri,
        scopes: provider.scopes || "(default)",
        customAuthorizeEndpoint: provider.customAuthorizeEndpoint || "(discovery)",
        customTokenEndpoint: provider.customTokenEndpoint || "(discovery)",
        origin: window.location.origin
      });
      void getOrCreateSessionVaultKey();
      popup = window.open("", "fhir4px-smart-auth", "popup,width=520,height=760");
      if (popup) {
        try {
          popup.document.title = "Connecting portal";
          popup.document.body.innerHTML =
            "<main style=\"font-family:system-ui;padding:24px\">Connecting to the patient portal...</main>";
        } catch {
          // Some browsers restrict access to the transient blank popup. The
          // popup can still navigate to the SMART authorization URL.
        }
      }

      const url = await buildAuthorizeUrl({ provider, redirectUri, popupLaunch: Boolean(popup) });
      console.info("[fhir4px:provider]", {
        event: "smart-authorize-url-built",
        timestamp: new Date().toISOString(),
        providerId: provider.id,
        authorizeUrl: url
      });
      if (popup) {
        popup.location.assign(url);
        void preloadNamingModel();
        setConnectStatus("Patient portal opened in a popup.");
        setConnectingProviderId(null);
      } else {
        window.location.assign(url);
      }
    } catch (caught) {
      popup?.close();
      const message = describeConnectError(provider, caught);
      console.error("[fhir4px:provider]", {
        event: provider.launchMode === "local-test-session" ? "sandbox-connect-failed" : "smart-connect-failed",
        timestamp: new Date().toISOString(),
        providerId: provider.id,
        message,
        error: caught
      });
      setError(message);
      setConnectionErrors((current) => ({ ...current, [providerKey]: message }));
      setConnectStatus(null);
      setConnectingProviderId(null);
    }
  }

  function addSelectedPortal(provider: DirectoryProvider) {
    setSelectedPortals((current) => {
      const key = portalKey(provider);
      if (current.some((item) => portalKey(item) === key)) return current;
      return [...current, provider];
    });
  }

  function removeSelectedPortal(key: string) {
    setSelectedPortals((current) => current.filter((provider) => portalKey(provider) !== key));
  }

  function toggleDetails(key: string) {
    setExpandedOptions((current) => ({
      ...current,
      [key]: !current[key]
    }));
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Search size={20} />
        <Typography variant="h2">Find a patient portal</Typography>
        <Chip size="small" label="Chicago 50-mile pilot" variant="outlined" />
      </Stack>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
        <TextField
          label="Provider, organization, or specialty"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="cardiology, Northwestern, Epic"
          fullWidth
        />
        <TextField
          select
          label="Sort"
          value={sort}
          onChange={(event) => setSort(event.target.value as DirectorySort)}
          sx={{ minWidth: { md: 180 } }}
        >
          <MenuItem value="name">Name</MenuItem>
          <MenuItem value="distance">Distance</MenuItem>
        </TextField>
        <TextField
          label="Origin"
          value={originText}
          onChange={(event) => setOriginText(event.target.value)}
          placeholder="60611"
          disabled={sort !== "distance"}
          sx={{ minWidth: { md: 180 } }}
        />
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {connectStatus && <Alert severity="info">{connectStatus}</Alert>}

      {selectedPortals.length > 0 && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <CheckCircle2 size={18} />
                <Typography variant="h2">Selected portals</Typography>
                <Chip size="small" label={`${selectedPortals.length}`} />
              </Stack>
              <Stack spacing={1}>
                {selectedPortals.map((provider) => {
                  const key = portalKey(provider);
                  const connectionError = connectionErrors[key];
                  return (
                    <Box
                      key={key}
                      sx={{
                        border: 1,
                        borderColor: "divider",
                        borderRadius: 1,
                        p: 1.25
                      }}
                    >
                      <Stack
                        direction={{ xs: "column", md: "row" }}
                        spacing={1}
                        alignItems={{ md: "center" }}
                      >
                        <Stack spacing={0.5} flexGrow={1} minWidth={0}>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Building2 size={16} />
                            <Typography fontWeight={700}>{portalDisplayName(provider)}</Typography>
                            <Chip
                              size="small"
                              color={recommendationColor(provider)}
                              label={recommendationLabel(provider)}
                            />
                            <Chip size="small" variant="outlined" label={`Source: ${sourcePathLabel(provider)}`} />
                          </Stack>
                          <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                            {provider.name}
                          </Typography>
                        </Stack>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Button
                            variant="contained"
                            startIcon={<ExternalLink size={18} />}
                            onClick={() => void connect(provider)}
                            disabled={!canLaunch(provider) || connectingProviderId === provider.id}
                          >
                            {connectingProviderId === provider.id
                              ? "Opening..."
                              : canLaunch(provider)
                                ? "Connect"
                                : "Registration needed"}
                          </Button>
                          <Tooltip title="Remove">
                            <IconButton
                              aria-label={`Remove ${portalDisplayName(provider)}`}
                              onClick={() => removeSelectedPortal(key)}
                            >
                              <Trash2 size={18} />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </Stack>
                      {connectionError && (
                        <Alert severity="error" sx={{ mt: 1 }}>
                          {connectionError}
                        </Alert>
                      )}
                    </Box>
                  );
                })}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Stack spacing={2}>
        {groups.map((group) => (
          <Card key={group.key} variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <Stack spacing={1}>
                  <Typography variant="h2">{group.name}</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {group.specialty && <Chip label={group.specialty} />}
                    {group.location && (
                      <Chip icon={<MapPin size={14} />} label={group.location} variant="outlined" />
                    )}
                    {group.distanceMiles !== null && group.distanceMiles !== undefined && (
                      <Chip label={`${group.distanceMiles.toFixed(1)} mi`} variant="outlined" />
                    )}
                    {group.npi && <Chip size="small" label={`NPI ${group.npi}`} variant="outlined" />}
                  </Stack>
                </Stack>

                <Divider />

                <Stack spacing={1.25}>
                  {group.options.map((provider) => {
                    const key = portalKey(provider);
                    const detailsKey = `${group.key}:${key}`;
                    const selected = selectedPortalKeys.has(key);
                    const connectionError = connectionErrors[key];
                    const sandboxPatientChoices =
                      provider.launchMode === "local-test-session"
                        ? sandboxPatients[provider.id] ?? configuredSandboxPatients(provider)
                        : [];
                    const sandboxPatientId =
                      provider.launchMode === "local-test-session" ? selectedSandboxPatientId(provider) : "";
                    return (
                      <Box
                        key={key}
                        sx={{
                          border: 1,
                          borderColor: selected ? "primary.main" : "divider",
                          borderRadius: 1,
                          p: 1.25
                        }}
                      >
                        <Stack spacing={1}>
                          <Stack
                            direction={{ xs: "column", md: "row" }}
                            spacing={1}
                            alignItems={{ md: "center" }}
                          >
                            <Stack spacing={0.75} flexGrow={1} minWidth={0}>
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Building2 size={16} />
                                <Typography fontWeight={700}>
                                  {portalDisplayName(provider)}
                                </Typography>
                                <Chip
                                  size="small"
                                  color={recommendationColor(provider)}
                                  label={recommendationLabel(provider)}
                                />
                                <Chip size="small" variant="outlined" label={`Source: ${sourcePathLabel(provider)}`} />
                                {selected && <Chip size="small" color="success" label="Selected" />}
                              </Stack>
                              <Typography color="text.secondary">
                                {provider.endpointStatus === "provider_only"
                                  ? "No portal association yet"
                                  : provider.launchMode === "local-test-session"
                                  ? "Local test session"
                                  : provider.clientId
                                    ? "Client ID configured"
                                    : "Registration needed before launch"}
                              </Typography>
                            </Stack>

                            <Stack direction="row" spacing={1} alignItems="center">
                              <Tooltip title="Evidence details">
                                <IconButton
                                  aria-label={`Details for ${portalDisplayName(provider)}`}
                                  aria-expanded={Boolean(expandedOptions[detailsKey])}
                                  onClick={() => toggleDetails(detailsKey)}
                                >
                                  {expandedOptions[detailsKey] ? <ChevronDown size={18} /> : <Info size={18} />}
                                </IconButton>
                              </Tooltip>
                              {provider.endpointStatus === "provider_only" ? (
                                <Button variant="outlined" disabled>
                                  Portal unknown
                                </Button>
                              ) : provider.launchMode === "local-test-session" ? (
                                <Button
                                  variant="contained"
                                  startIcon={<ExternalLink size={18} />}
                                  onClick={() => void connect(provider)}
                                  disabled={connectingProviderId === provider.id || !sandboxPatientId}
                                >
                                  {connectingProviderId === provider.id ? "Opening..." : "Use sandbox"}
                                </Button>
                              ) : provider.clientId ? (
                                <Button
                                  variant="contained"
                                  startIcon={<ExternalLink size={18} />}
                                  onClick={() => void connect(provider)}
                                  disabled={connectingProviderId === provider.id}
                                >
                                  {connectingProviderId === provider.id ? "Opening..." : "Add portal"}
                                </Button>
                              ) : (
                                <Button
                                  variant={selected ? "outlined" : "contained"}
                                  startIcon={<Plus size={18} />}
                                  onClick={() => addSelectedPortal(provider)}
                                  disabled={selected}
                                >
                                  {selected ? "Selected" : "This is my portal"}
                                </Button>
                              )}
                            </Stack>
                          </Stack>

                          {provider.launchMode === "local-test-session" && (
                            <TextField
                              select
                              label="Patient"
                              value={sandboxPatientId}
                              onChange={(event) =>
                                setSelectedSandboxPatients((current) => ({
                                  ...current,
                                  [provider.id]: event.target.value
                                }))
                              }
                              sx={{ maxWidth: { md: 420 } }}
                            >
                              {sandboxPatientChoices.map((patient) => (
                                <MenuItem key={patient.id} value={patient.id}>
                                  {patient.label} ({patient.id})
                                </MenuItem>
                              ))}
                            </TextField>
                          )}

                          {connectionError && <Alert severity="error">{connectionError}</Alert>}

                          <Collapse in={Boolean(expandedOptions[detailsKey])}>
                            <Stack spacing={0.75} sx={{ pt: 1 }}>
                              {provider.rawAccessBrand && provider.rawAccessBrand !== provider.accessBrand && (
                                <Typography color="text.secondary">Raw brand: {provider.rawAccessBrand}</Typography>
                              )}
                              {provider.practiceOrganizationNames && (
                                <Typography color="text.secondary">
                                  Practice/group: {provider.practiceOrganizationNames}
                                </Typography>
                              )}
                              {provider.evidencePathClass && (
                                <Typography color="text.secondary">
                                  Source path: {sourcePathLabel(provider)} ({provider.evidencePathClass})
                                </Typography>
                              )}
                              {provider.pathSummary && (
                                <Typography color="text.secondary">{provider.pathSummary}</Typography>
                              )}
                              {provider.empiricalPrecisionAt1 !== undefined && (
                                <Typography color="text.secondary">
                                  Calibration: {Math.round(provider.empiricalPrecisionAt1 * 100)}% precision@1,{" "}
                                  {Math.round((provider.empiricalRecallAt3 ?? 0) * 100)}% recall@3
                                </Typography>
                              )}
                              {provider.evidence && (
                                <Typography color="text.secondary">{provider.evidence}</Typography>
                              )}
                              {provider.fhirBaseUrl && (
                                <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                                  {provider.fhirBaseUrl}
                                </Typography>
                              )}
                            </Stack>
                          </Collapse>
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
