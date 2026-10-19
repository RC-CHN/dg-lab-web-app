// Local UI QA server. All official services are replaced with in-memory fixtures.
import { createApp } from "../server/index.mjs";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { ADMIN_PASSWORD, mockApi, MockRoom } from "./fixtures.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const settingsDir = mkdtempSync(path.join(tmpdir(), "dglab-ui-settings-"));
const app = createApp({
  connectionPresetFile: path.join(settingsDir, "connection.json"),
  adminPassword: ADMIN_PASSWORD,
  apiFactory: mockApi,
  roomFactory: (api) => new MockRoom(api),
});
const vite = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true },
  appType: "spa",
});
app.use(vite.middlewares);
const server = app.listen(8787, "127.0.0.1", () =>
  console.log(
    "Offline UI fixture: http://127.0.0.1:8787 (no official services)",
  ),
);
const stop = async () => {
  await app.locals.dispose();
  await vite.close();
  rmSync(settingsDir, { recursive: true, force: true });
  server.close(() => process.exit(0));
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
