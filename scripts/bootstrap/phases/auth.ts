import { log } from "@clack/prompts";
import { runCommand, runInteractiveCommand } from "../lib/shell.js";
import { printToolTable, promptConfirm, type ToolRow } from "../lib/ui.js";

export interface PhaseResult {
  success: boolean;
}

interface AuthTool {
  label: string;
  checkCommand: string;
  loginCommand: string;
}

const AUTH_TOOLS: AuthTool[] = [
  {
    label: "GitHub CLI",
    checkCommand: "gh auth status",
    loginCommand: "gh auth login",
  },
  {
    label: "Cloudflare Wrangler",
    checkCommand: "wrangler whoami 2>/dev/null | grep -q '@'",
    loginCommand: "wrangler login",
  },
];

/** Confirms `gh` and `wrangler` are both authenticated, offering to log in
 *  interactively when either isn't. Neither tool's absence is fatal here —
 *  a missing binary just gets reported as failed with the login command to
 *  run once it's installed. */
export async function runAuthPhase(): Promise<PhaseResult> {
  const rows: ToolRow[] = [];
  let allReady = true;

  for (const tool of AUTH_TOOLS) {
    const check = runCommand(tool.checkCommand);
    if (check.ok) {
      rows.push({ label: tool.label, status: "ready", detail: "authenticated" });
      continue;
    }

    if (rows.length > 0) {
      printToolTable("CLI authentication", rows);
      rows.length = 0;
    }

    const shouldAuth = await promptConfirm(`${tool.label} is not authenticated. Log in now?`, true);
    if (!shouldAuth) {
      rows.push({ label: tool.label, status: "deferred", detail: `run \`${tool.loginCommand}\` later` });
      allReady = false;
      continue;
    }

    const loginOk = runInteractiveCommand(tool.loginCommand);
    const recheck = loginOk ? runCommand(tool.checkCommand) : { ok: false, stdout: "", stderr: "" };
    if (recheck.ok) {
      rows.push({ label: tool.label, status: "ready", detail: "authenticated" });
    } else {
      rows.push({ label: tool.label, status: "failed", detail: "login did not stick" });
      allReady = false;
    }
  }

  if (rows.length > 0) printToolTable("CLI authentication", rows);
  if (!allReady) {
    log.warn("Continuing — later phases that need gh/wrangler will fail until you authenticate both.");
  }
  return { success: allReady };
}
