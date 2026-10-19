// Fail closed on tracked local state; report paths/rule names, never values.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createHash } from "node:crypto";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
if (!files.length)
  throw new Error("Stage the intended public files before running the check.");
const failures = [];
const denied =
  /(^|\/)(node_modules|dist|test-results|playwright-report|private|artifacts|original|unpacked|credentials|secrets)(\/|$)|\.(apk|jks|keystore|pem|key|p12|pfx|log)$/i;
const rules = [
  ["private-key", /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/],
  [
    "github-token",
    /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/,
  ],
  ["cloud-access-key", /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  ["machine-home", /\/(?:home|Users)\/[A-Za-z0-9_.-]+\//],
  ["workspace-path", /\/workspace\/projects\//],
  ["jwt", /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\b/],
];
for (const file of files) {
  if (
    denied.test(file) ||
    (/(^|\/)\.env(?:\.|$)/.test(file) && file !== ".env.example")
  )
    failures.push(`${file}: excluded local file`);
  if (!fs.existsSync(file)) {
    failures.push(`${file}: missing tracked file`);
    continue;
  }
  if (fs.lstatSync(file).isSymbolicLink()) {
    failures.push(`${file}: symlinks are not published`);
    continue;
  }
  // Scan byte strings too, including the bundled runtime, without dumping them.
  const bytes = fs.readFileSync(file),
    content = bytes.toString("utf8");
  // The unmodified upstream WASM embeds its original compiler source paths.
  // Exempt only that rule for this exact digest; any edited binary is rescanned.
  const upstreamRuntime =
    file === "vendor/security.wasm" &&
    createHash("sha256").update(bytes).digest("hex") ===
      "7a11187c4557e7783d0d38c372ddf3b6e382caeb58323877d769ea21ecc0138e";
  for (const [name, rule] of rules)
    if (!(upstreamRuntime && name === "machine-home") && rule.test(content))
      failures.push(`${file}: ${name}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `Public boundary check passed (${files.length} tracked files). Run Gitleaks as well for the full history.`,
);
