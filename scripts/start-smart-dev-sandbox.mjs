import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SANDBOX_DIR = resolve("build/test-harness/smart-dev-sandbox");
const FHIR_BASE_URL = "http://localhost:4004/hapi-fhir-jpaserver/fhir";
const METADATA_URL = `${FHIR_BASE_URL}/metadata`;
const WINDOWS_DOCKER = "/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe";
const R4_SERVICES = ["r4", "fhir-viewer", "patient-browser", "index", "smart-launcher"];

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

function dockerCommand() {
  if (process.env.DOCKER_CLI) return process.env.DOCKER_CLI;
  if (commandAvailable("docker")) return "docker";
  if (existsSync(WINDOWS_DOCKER) && commandAvailable(WINDOWS_DOCKER)) return WINDOWS_DOCKER;
  return null;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function waitForMetadata(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(METADATA_URL, {
        headers: { Accept: "application/fhir+json" },
        cache: "no-store"
      });
      if (response.ok) return true;
    } catch {
      // HAPI takes a while to boot. Keep polling until the timeout.
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 2_000));
  }
  return false;
}

async function main() {
  if (!existsSync(resolve(SANDBOX_DIR, "docker-compose.yml"))) {
    throw new Error(`SMART Dev Sandbox compose file not found at ${SANDBOX_DIR}`);
  }

  const docker = dockerCommand();
  if (!docker) {
    throw new Error("Docker CLI not found. Install Docker Desktop or enable Docker Desktop WSL integration.");
  }

  try {
    await run(docker, ["compose", "up", "-d", ...R4_SERVICES], { cwd: SANDBOX_DIR });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}\n\nDocker Desktop does not appear to be reachable from WSL. Start Docker Desktop, enable WSL integration for this distro, then retry.`
    );
  }

  process.stdout.write(`Waiting for ${METADATA_URL}\n`);
  const ready = await waitForMetadata();
  if (!ready) {
    throw new Error(`SMART Dev Sandbox started, but ${METADATA_URL} did not become ready within 120 seconds.`);
  }

  process.stdout.write(`SMART Dev Sandbox is ready at ${FHIR_BASE_URL}\n`);
  process.stdout.write("Load fixtures with: npm run sandbox:load-fixtures\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
