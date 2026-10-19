// Local UI QA server. All official services are replaced with in-memory fixtures.
import { createApp } from "../server/index.mjs";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { ADMIN_PASSWORD, mockApi, MockRoom } from "./fixtures.mjs";
const app = createApp({
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
  server.close(() => process.exit(0));
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
