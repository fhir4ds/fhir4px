import { chromium } from "@playwright/test";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const DEFAULT_APP_URL = "http://localhost:3000/llm-playground?eval=1";
const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 3877;
const DEFAULT_CDP_PORT = 9222;
const DEFAULT_PROFILE_DIR = path.join(os.tmpdir(), "fhir4px-webllm-eval-chrome");
const DEFAULT_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
];

function parseArgs(argv) {
  const options = {
    appUrl: DEFAULT_APP_URL,
    httpHost: DEFAULT_HTTP_HOST,
    httpPort: DEFAULT_HTTP_PORT,
    cdpPort: DEFAULT_CDP_PORT,
    cdpUrl: "",
    launch: true,
    windows: false,
    windowsChild: false,
    chromePath: "",
    userDataDir: DEFAULT_PROFILE_DIR,
    token: crypto.randomBytes(18).toString("base64url")
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--no-launch") options.launch = false;
    else if (arg === "--windows") options.windows = true;
    else if (arg === "--windows-child") options.windowsChild = true;
    else if (arg.startsWith("--app-url=")) options.appUrl = arg.slice("--app-url=".length);
    else if (arg.startsWith("--http-host=")) options.httpHost = arg.slice("--http-host=".length);
    else if (arg.startsWith("--http-port=")) options.httpPort = Number(arg.slice("--http-port=".length));
    else if (arg.startsWith("--cdp-port=")) options.cdpPort = Number(arg.slice("--cdp-port=".length));
    else if (arg.startsWith("--cdp-url=")) options.cdpUrl = arg.slice("--cdp-url=".length);
    else if (arg.startsWith("--chrome-path=")) options.chromePath = arg.slice("--chrome-path=".length);
    else if (arg.startsWith("--user-data-dir=")) options.userDataDir = arg.slice("--user-data-dir=".length);
    else if (arg.startsWith("--token=")) options.token = arg.slice("--token=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.httpPort) || options.httpPort <= 0) throw new Error("--http-port must be a positive number");
  if (!Number.isFinite(options.cdpPort) || options.cdpPort <= 0) throw new Error("--cdp-port must be a positive number");
  return options;
}

function usage() {
  return [
    "Usage: node scripts/webllm-eval-daemon.mjs [options]",
    "",
    "Options:",
    "  --app-url=http://localhost:3000/llm-playground?eval=1",
    "  --http-host=127.0.0.1",
    "  --http-port=3877",
    "  --cdp-port=9222",
    "  --cdp-url=http://127.0.0.1:9222",
    "  --chrome-path=/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "  --user-data-dir=/tmp/fhir4px-webllm-eval-chrome",
    "  --token=...",
    "  --no-launch       Attach to an already running remote-debug Chrome.",
    "  --windows         Re-run this daemon under Windows Node from WSL.",
    "",
    "Endpoints:",
    "  GET  /health",
    "  POST /warm",
    "  POST /structured-completion",
    "  POST /prompt-suite",
    "  POST /lab-association-suite",
    "",
    "All POST endpoints require header: x-eval-token: <token printed at startup>"
  ].join("\n");
}

function findBrowserPath(explicitPath) {
  if (explicitPath) return explicitPath;
  return DEFAULT_CHROME_PATHS.find((candidate) => fs.existsSync(candidate)) ?? "";
}

function windowsPathForChrome(value) {
  if (process.platform === "win32") return value;
  if (!value.startsWith("/")) return value;
  try {
    return execFileSync("wslpath", ["-w", value], { encoding: "utf8" }).trim();
  } catch {
    return value;
  }
}

function windowsTempDir() {
  if (process.platform === "win32") return os.tmpdir();
  try {
    return execFileSync("cmd.exe", ["/c", "echo %TEMP%"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function chromeUserDataDir(value, cdpPort) {
  if (value === DEFAULT_PROFILE_DIR) {
    const temp = windowsTempDir();
    if (temp) return `${temp}\\fhir4px-webllm-eval-chrome-${cdpPort}`;
  }
  return windowsPathForChrome(value);
}

function cmdQuote(value) {
  const text = String(value);
  if (!/[\s"&()<>^|]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function reexecUnderWindowsNode(rawArgs) {
  const scriptPath = windowsPathForChrome(fileURLToPath(import.meta.url));
  const forwardedArgs = rawArgs.filter((arg) => arg !== "--windows" && arg !== "--windows-child");
  forwardedArgs.push("--windows-child");
  const command = ["node", cmdQuote(scriptPath), ...forwardedArgs.map(cmdQuote)].join(" ");
  const child = spawn("cmd.exe", ["/c", command], { stdio: "inherit" });
  const code = await new Promise((resolve) => {
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
    child.on("error", () => resolve(1));
  });
  process.exitCode = code;
}

function launchBrowser(options) {
  const browserPath = findBrowserPath(options.chromePath);
  if (!browserPath) {
    throw new Error(
      "Could not find Chrome or Edge. Launch Chrome manually with remote debugging, then rerun with --no-launch --cdp-url=http://127.0.0.1:9222."
    );
  }

  const browserArgs = [
    `--remote-debugging-port=${options.cdpPort}`,
    "--remote-debugging-address=0.0.0.0",
    `--user-data-dir=${chromeUserDataDir(options.userDataDir, options.cdpPort)}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-webgpu",
    "--ignore-gpu-blocklist",
    "--new-window",
    options.appUrl
  ];

  const isWindowsExe = browserPath.toLowerCase().endsWith(".exe");
  const child = isWindowsExe
    ? spawn("cmd.exe", ["/c", "start", "", windowsPathForChrome(browserPath), ...browserArgs], {
        detached: true,
        stdio: "ignore"
      })
    : spawn(browserPath, browserArgs, {
        detached: true,
        stdio: "ignore"
      });
  child.unref();
  return { browserPath, browserArgs };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdp(cdpUrl, timeoutMs = 20_000) {
  const startedAt = Date.now();
  const versionUrl = new URL("/json/version", cdpUrl).toString();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(versionUrl);
      if (response.ok) return await response.json();
      lastError = new Error(`CDP returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for Chrome DevTools at ${versionUrl}. Last error: ${lastError?.message ?? lastError}`);
}

function windowsHostIp() {
  try {
    const text = fs.readFileSync("/etc/resolv.conf", "utf8");
    return text.match(/^nameserver\s+(\S+)/m)?.[1] ?? "";
  } catch {
    return "";
  }
}

function cdpUrlCandidates(options) {
  if (options.cdpUrl) return [options.cdpUrl];
  return [
    `http://127.0.0.1:${options.cdpPort}`,
    `http://localhost:${options.cdpPort}`,
    windowsHostIp() ? `http://${windowsHostIp()}:${options.cdpPort}` : ""
  ].filter(Boolean);
}

async function waitForAnyCdp(candidates, timeoutMs = 20_000) {
  const startedAt = Date.now();
  const errors = [];
  while (Date.now() - startedAt < timeoutMs) {
    for (const candidate of candidates) {
      try {
        const version = await waitForCdp(candidate, 500);
        return { cdpUrl: candidate, version };
      } catch (error) {
        errors.push(`${candidate}: ${error.message ?? error}`);
      }
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for Chrome DevTools. Tried: ${candidates.join(", ")}. Last error: ${errors.at(-1)}`);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5_000_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body, null, 2));
}

function requireToken(request, token) {
  return request.headers["x-eval-token"] === token;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const options = parseArgs(rawArgs);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.windows && !options.windowsChild && process.platform !== "win32") {
    await reexecUnderWindowsNode(rawArgs);
    return;
  }

  if (options.launch) {
    const launched = launchBrowser(options);
    console.log(`[webllm-eval] Launched browser: ${launched.browserPath}`);
  } else {
    console.log(`[webllm-eval] Attaching to existing browser`);
  }

  const cdpCandidates = cdpUrlCandidates(options);
  const { cdpUrl } = await waitForAnyCdp(cdpCandidates);
  console.log(`[webllm-eval] Connected to Chrome DevTools: ${cdpUrl}`);
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  let page =
    context.pages().find((candidate) => candidate.url().startsWith(options.appUrl.split("?")[0])) ??
    context.pages()[0] ??
    (await context.newPage());
  await page.goto(options.appUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[fhir4px:webllm]")) console.log(`[browser:${message.type()}] ${text}`);
  });
  page.on("pageerror", (error) => {
    console.warn(`[browser:pageerror] ${error.stack ?? error.message}`);
  });

  async function ensurePage() {
    if (page.isClosed()) {
      page = await context.newPage();
      await page.goto(options.appUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    return page;
  }

  async function evaluateStructuredCompletion(input) {
    const targetPage = await ensurePage();
    return targetPage.evaluate(async (payload) => {
      const mod = await import("/src/lib/llm/webllm.ts");
      const progress = [];
      const diagnostics = [];
      const result = await mod.runStructuredWebLlmPlayground(
        {
          operationLabel: payload.operationLabel ?? "eval structured completion",
          messages: payload.messages,
          schemaText: payload.schemaText,
          maxTokens: payload.maxTokens ?? 180,
          timeoutMs: payload.timeoutMs
        },
        {
          modelPreference: payload.modelPreference ?? "one-b",
          timeoutMs: payload.timeoutMs,
          onProgress: (message) => progress.push(message),
          onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
        }
      );
      return { progress, diagnostics, result };
    }, input);
  }

  async function evaluateLabAssociationSuite(input) {
    const targetPage = await ensurePage();
    return targetPage.evaluate(async (payload) => {
      const mod = await import("/src/lib/llm/webllm.ts");
      const progress = [];
      const diagnostics = [];
      const result = await mod.runLabAssociationEvalSuite(payload, {
        modelPreference: payload.modelPreference ?? "one-b",
        timeoutMs: payload.timeoutMs,
        onProgress: (message) => progress.push(message),
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
      });
      return { progress, diagnostics, result };
    }, input);
  }

  async function warmModel(input) {
    const targetPage = await ensurePage();
    return targetPage.evaluate(async (payload) => {
      const mod = await import("/src/lib/llm/webllm.ts");
      const progress = [];
      const diagnostics = [];
      const ok = await mod.warmWebLlmGroupingModel({
        modelPreference: payload.modelPreference ?? "one-b",
        timeoutMs: payload.timeoutMs,
        onProgress: (message) => progress.push(message),
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
      });
      return { ok, progress, diagnostics, warmupStatus: mod.getWebLlmWarmupStatus() };
    }, input);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${options.httpHost}:${options.httpPort}`);
      if (request.method === "GET" && requestUrl.pathname === "/health") {
        const status = await (await ensurePage()).evaluate(async () => {
          const mod = await import("/src/lib/llm/webllm.ts");
          return {
            url: window.location.href,
            canAttemptWebLlm: mod.browserCanAttemptWebLlm(),
            warmupStatus: mod.getWebLlmWarmupStatus(),
            hasNavigatorGpu: "gpu" in navigator,
            webdriver: navigator.webdriver
          };
        });
        writeJson(response, 200, { ok: true, appUrl: options.appUrl, cdpUrl, httpHost: options.httpHost, status });
        return;
      }

      if (request.method !== "POST") {
        writeJson(response, 404, { ok: false, error: "Not found" });
        return;
      }
      if (!requireToken(request, options.token)) {
        writeJson(response, 401, { ok: false, error: "Missing or invalid x-eval-token header" });
        return;
      }

      const input = await readJsonBody(request);
      if (requestUrl.pathname === "/warm") {
        writeJson(response, 200, { ok: true, ...(await warmModel(input)) });
        return;
      }
      if (requestUrl.pathname === "/structured-completion") {
        writeJson(response, 200, { ok: true, ...(await evaluateStructuredCompletion(input)) });
        return;
      }
      if (requestUrl.pathname === "/prompt-suite" || requestUrl.pathname === "/lab-association-suite") {
        writeJson(response, 200, { ok: true, ...(await evaluateLabAssociationSuite(input)) });
        return;
      }

      writeJson(response, 404, { ok: false, error: "Not found" });
    } catch (error) {
      writeJson(response, 500, { ok: false, error: error.stack ?? error.message ?? String(error) });
    }
  });

  server.listen(options.httpPort, options.httpHost, () => {
    const exampleHost = options.httpHost === "0.0.0.0" ? "127.0.0.1" : options.httpHost;
    console.log(`[webllm-eval] API listening on http://${options.httpHost}:${options.httpPort}`);
    console.log(`[webllm-eval] Token: ${options.token}`);
    console.log(`[webllm-eval] Warm model:`);
    console.log(`  curl -X POST http://${exampleHost}:${options.httpPort}/warm -H 'x-eval-token: ${options.token}' -H 'content-type: application/json' -d '{}'`);
    console.log(`[webllm-eval] Run default prompt suite:`);
    console.log(`  curl -X POST http://${exampleHost}:${options.httpPort}/prompt-suite -H 'x-eval-token: ${options.token}' -H 'content-type: application/json' -d '{}'`);
  });

  async function shutdown() {
    server.close(async () => {
      if (options.launch) await browser.close().catch(() => {});
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error.stack ?? error.message ?? String(error));
  process.exitCode = 1;
});
