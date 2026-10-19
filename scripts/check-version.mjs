import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const pkg = read("package.json"), lock = read("package-lock.json");
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
assert.equal(lock.version, pkg.version, "lockfile version differs");
assert.equal(lock.packages[""].version, pkg.version, "root lockfile version differs");
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
assert(changelog.includes(`## ${pkg.version} — `), "current release is missing from CHANGELOG.md");
if (process.env.GITHUB_REF?.startsWith("refs/tags/"))
  assert.equal(process.env.GITHUB_REF, `refs/tags/v${pkg.version}`, "release tag differs from package version");
console.log(`Version check passed: v${pkg.version}`);
