import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConnectionPreset } from "../server/connection-preset.mjs";

test("connection presets persist privately, retain blank passwords only for the same account and delete from disk", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dglab-preset-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "settings.json"),
    store = new ConnectionPreset(file);
  const saved = store.save({
    phone: "15500000000",
    password: "fixture-secret",
    code: "TEST1234",
    roomPassword: "room-secret",
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.password, undefined);
  assert.equal(saved.roomPassword, undefined);
  assert(!JSON.stringify(saved).includes("secret"));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const reopened = new ConnectionPreset(file);
  assert.equal(reopened.credentials().password, "fixture-secret");
  reopened.save({
    phone: "15500000000",
    password: "",
    code: "NEW12345",
    clearRoomPassword: true,
  });
  assert.equal(reopened.credentials().password, "fixture-secret");
  assert.equal(reopened.credentials().roomPassword, "");
  assert.throws(
    () =>
      reopened.save({ phone: "15500000001", password: "", code: "TEST1234" }),
    /密码/,
  );
  assert.throws(
    () => reopened.save({ phone: "15500000000", code: "bad code" }),
    /远程码/,
  );
  assert.equal(new ConnectionPreset(file).credentials().code, "NEW12345");
  reopened.clear();
  assert.equal(fs.existsSync(file), false);
  assert.equal(new ConnectionPreset(file).publicState().configured, false);
  assert.throws(() => new ConnectionPreset().save({}), /存储/);
});
