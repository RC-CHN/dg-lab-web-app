// Package exactly Git HEAD; ignored files and local credentials cannot enter it.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))
  throw new Error("Invalid version");
mkdirSync("artifacts", { recursive: true });
const filename = `dg-lab-web-app-${version}.tar.gz`;
execFileSync("git", [
  "archive",
  "--format=tar.gz",
  "--prefix=dg-lab-web-app/",
  `--output=artifacts/${filename}`,
  "HEAD",
]);
const sha = createHash("sha256")
  .update(readFileSync(`artifacts/${filename}`))
  .digest("hex");
writeFileSync(`artifacts/${filename}.sha256`, `${sha}  ${filename}\n`);
console.log(`artifacts/${filename}`);
