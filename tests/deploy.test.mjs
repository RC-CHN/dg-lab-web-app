import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/deploy.sh", import.meta.url));
const image = `ghcr.io/example/panel:sha-${"a".repeat(40)}`;
for (const failure of [false, true]) {
  test(
    `deployment ${failure ? "rolls back unhealthy image without changing env" : "persists only a healthy image"}`,
    { skip: process.platform !== "linux" },
    async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), "panel-deploy-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      await mkdir(path.join(root, "bin"));
      const env =
        "ADMIN_PASSWORD=Fixture-Only-Not-Real\nPANEL_IMAGE=ghcr.io/example/panel:v1.0.0\nAPP_ORIGIN=https://panel.example.com\n";
      await writeFile(path.join(root, ".env"), env, { mode: 0o600 });
      for (const file of ["compose.production.yaml", "Caddyfile"])
        await writeFile(path.join(root, file), "fixture");
      await writeFile(
        path.join(root, "bin/docker"),
        `#!/usr/bin/env bash
set -eu
printf '%s %s\\n' "\${PANEL_IMAGE:-unset}" "$*" >> "$FIXTURE_LOG"
case "$*" in
  *'ps -q panel') echo fixture-container ;;
  'inspect '*) echo ghcr.io/example/panel:v1.0.0 ;;
  *'up -d '*) if [[ "$FAIL_UPGRADE" == 1 && "$PANEL_IMAGE" == *:sha-* ]]; then exit 1; fi ;;
esac
`,
        { mode: 0o755 },
      );
      const res = spawnSync("bash", [script, image, root], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${root}/bin:${process.env.PATH}`,
          FIXTURE_LOG: path.join(root, "commands"),
          FAIL_UPGRADE: failure ? "1" : "0",
        },
      });
      assert.equal(res.status, failure ? 1 : 0, res.stderr);
      const after = await readFile(path.join(root, ".env"), "utf8"),
        commands = await readFile(path.join(root, "commands"), "utf8");
      assert(after.includes("ADMIN_PASSWORD=Fixture-Only-Not-Real"));
      assert(!commands.includes("Fixture-Only-Not-Real"));
      if (failure) {
        assert.equal(after, env);
        assert(commands.includes("ghcr.io/example/panel:v1.0.0 compose"));
      } else assert(after.includes(`PANEL_IMAGE=${image}\n`));
      assert.equal(
        spawnSync("bash", [script, "malformed;echo bad", root]).status,
        1,
      );
    },
  );
}
