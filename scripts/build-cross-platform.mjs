import { spawn } from "node:child_process";
import { resolve } from "node:path";

const timeoutMilliseconds = Number.parseInt(process.env.SITES_BUILD_TIMEOUT_MS || "180000", 10);
const executable = resolve(process.cwd(), "node_modules", "vinext", "dist", "cli.js");
const child = spawn(process.execPath, [executable, "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_WRITE_LOGS: process.env.WRANGLER_WRITE_LOGS || "false",
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || ".wrangler/logs",
    MINIFLARE_REGISTRY_PATH: process.env.MINIFLARE_REGISTRY_PATH || ".wrangler/registry",
  },
});

const timeout = setTimeout(() => {
  console.error(`Build exceeded ${timeoutMilliseconds}ms and was terminated.`);
  child.kill("SIGTERM");
}, timeoutMilliseconds);

child.on("error", (error) => {
  clearTimeout(timeout);
  console.error("Unable to launch vinext.", error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  if (signal) {
    console.error(`Build terminated by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
