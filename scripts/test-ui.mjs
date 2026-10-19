// Own the fixture server and leave no background process after success/failure.
import { spawn } from "node:child_process";
import { once } from "node:events";

const base = "http://127.0.0.1:8787";
try {
  const response = await fetch(`${base}/healthz`, {
    signal: AbortSignal.timeout(500),
  });
  if (response.ok)
    throw new Error(
      "Port 8787 is already in use; stop the existing server before UI tests.",
    );
} catch (error) {
  if (error.message.startsWith("Port ")) throw error;
}
const server = spawn(process.execPath, ["tests/ui-server.mjs"], {
  stdio: "inherit",
  env: { ...process.env, APP_ORIGIN: "" },
});
const exit = once(server, "exit");
let child;
const stop = () => {
  child?.kill("SIGTERM");
  server.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error("UI fixture exited before startup");
    try {
      if ((await fetch(`${base}/healthz`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("UI fixture startup timed out");
  for (const file of [
    "browser",
    "admin-browser",
    "qr-browser",
    "lab-browser",
    "coop-browser",
    "ux-browser",
    "theme-browser",
    "scope-browser",
    "parity-browser",
  ]) {
    child = spawn(process.execPath, [`tests/${file}.mjs`], {
      stdio: "inherit",
      env: { ...process.env, APP_ORIGIN: "" },
    });
    const [code] = await once(child, "exit");
    if (code !== 0) throw new Error(`${file} failed (${code})`);
  }
} finally {
  stop();
  await exit;
}
