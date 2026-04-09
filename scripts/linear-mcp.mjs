/**
 * MCP stdio bridge: loads LINEAR_API_KEY from the repo .env and runs mcp-remote
 * against Linear's hosted MCP with a Bearer header (no key in mcp.json).
 * @see https://linear.app/docs/mcp
 * @see https://github.com/geelen/mcp-remote
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const envPath = join(root, ".env");

function loadDotEnv(path) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!existsSync(path)) {
    console.error(`linear-mcp: missing .env (expected ${path})`);
    process.exit(1);
  }
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const fileEnv = loadDotEnv(envPath);
const apiKey = fileEnv.LINEAR_API_KEY?.trim();
if (!apiKey) {
  console.error("linear-mcp: LINEAR_API_KEY is not set in .env");
  process.exit(1);
}

const authHeader = `Bearer ${apiKey}`;

const args = [
  "-y",
  "mcp-remote",
  "https://mcp.linear.app/mcp",
  "--header",
  "Authorization:${AUTH_HEADER}",
];

/** @type {import('node:child_process').SpawnOptions} */
const opts = {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, AUTH_HEADER: authHeader },
};

if (process.platform === "win32") {
  opts.shell = true;
}

const child = spawn("npx", args, opts);

child.on("error", (err) => {
  console.error("linear-mcp:", err.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});

process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
