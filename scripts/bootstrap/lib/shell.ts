import { spawnSync } from "node:child_process";

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Always /bin/sh — POSIX, no zshenv/zshrc/profile loading. */
function resolveShell(): string {
  return "/bin/sh";
}

/**
 * Env vars that must NEVER reach subprocesses. A Cloudflare API token
 * pasted into this script's prompt is only ever handed to `gh secret set`
 * directly (see phases/ci-secrets.ts) — never exported into the general
 * subprocess environment, where it could leak into wrangler's own logs/state
 * or confuse wrangler about which token to use.
 */
const SUBPROCESS_ENV_DENYLIST: ReadonlySet<string> = new Set(["CLOUDFLARE_API_TOKEN"]);

function subprocessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SUBPROCESS_ENV_DENYLIST.has(key)) continue;
    env[key] = value;
  }
  return env;
}

export function runCommand(command: string): CommandResult {
  const result = spawnSync(resolveShell(), ["-c", command], {
    stdio: "pipe",
    encoding: "utf8",
    env: subprocessEnv(),
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

export function runInteractiveCommand(command: string): boolean {
  const result = spawnSync(resolveShell(), ["-c", command], {
    stdio: "inherit",
    env: subprocessEnv(),
  });
  return result.status === 0;
}

/** POSIX-shell single-quote a string so it survives `sh -c '<cmd>'` interpolation. */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Best-effort cross-platform "open this URL in the user's default browser".
 * Returns false when no opener is available (e.g. headless SSH); caller
 * should fall back to printing the URL and letting the user click it.
 */
export function tryOpenInBrowser(url: string): boolean {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open";
  const r = runCommand(`${opener} ${shellEscape(url)}`);
  return r.ok;
}
