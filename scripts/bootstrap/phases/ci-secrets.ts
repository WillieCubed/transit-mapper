import { log, note } from "@clack/prompts";
import { runCommand, shellEscape, tryOpenInBrowser } from "../lib/shell.js";
import { promptConfirm, promptSecret } from "../lib/ui.js";
import type { PhaseResult } from "./auth.js";

const GITHUB_ENVIRONMENT = "production";

/**
 * Account-scoped API token page: tokens created here are bound to a single
 * Cloudflare account from the start, unlike the user-scoped
 * `/profile/api-tokens` page which can roam across every account the user
 * is a member of.
 */
function tokenDashboardUrl(accountId: string): string {
  return `https://dash.cloudflare.com/${accountId}/api-tokens`;
}

/**
 * Step-by-step instructions shown before the token prompt. This is the part
 * that makes the prompt usable by someone who has never created a Cloudflare
 * API token before — a bare "paste your token" prompt with no context is not
 * "standardized bootstrap tooling," it's a trap for anyone who isn't already
 * a Cloudflare/Workers expert.
 */
function tokenPromptBody(accountId: string): string {
  return [
    "This lets GitHub Actions deploy the Worker on every push to main.",
    "",
    `  1. Open ${tokenDashboardUrl(accountId)} (opening it for you now)`,
    '  2. Find "Edit Cloudflare Workers" and click "Use template"',
    "     (this pre-fills the Account/Zone permissions a Worker deploy needs)",
    "  3. Under Permissions, add one more row set to Edit:",
    "       Account → D1",
    "  4. Under Account Resources, choose this account",
    "     Under Zone Resources, choose this account's zones (or All zones)",
    '  5. Click "Continue to summary", then "Create Token"',
    "  6. Copy the token from the success screen",
    "  7. Paste it below (it will not be shown on screen as you type)",
  ].join("\n");
}

/**
 * Extract `{ name, id }` pairs from a `wrangler whoami` table. Anchors on
 * the box-drawing pipe (`│`) plus a 32-character lowercase hex account id,
 * since wrangler's table format is the stable part of its output, not the
 * surrounding prose.
 */
function parseAccountIds(stdout: string): string[] {
  const rowRe = /│\s*([^│]+?)\s*│\s*([0-9a-f]{32})\s*│/g;
  const ids: string[] = [];
  for (const line of stdout.split("\n")) {
    rowRe.lastIndex = 0;
    const match = rowRe.exec(line);
    if (!match) continue;
    const name = match[1]!.trim();
    const id = match[2]!.trim();
    if (name.toLowerCase() === "account name") continue;
    ids.push(id);
  }
  return ids;
}

/**
 * Prompts for a Cloudflare API token, derives the account id from
 * `wrangler whoami` (no need to ask the user to hunt it down and paste it),
 * and writes both into the repo's `production` GitHub Environment via `gh`.
 * The token is passed straight to `gh secret set` and never touches the
 * general subprocess environment (see the denylist in lib/shell.ts) or any
 * on-disk file.
 */
export async function runCiSecretsPhase(): Promise<PhaseResult> {
  const whoami = runCommand("wrangler whoami");
  if (!whoami.ok) {
    log.error("`wrangler whoami` failed — make sure the auth phase succeeded first.");
    return { success: false };
  }

  const accountIds = parseAccountIds(whoami.stdout);
  if (accountIds.length === 0) {
    log.error("Could not parse an account id out of `wrangler whoami` output.");
    return { success: false };
  }
  const accountId = accountIds[0]!;
  log.info(`Using Cloudflare account id ${accountId} (from \`wrangler whoami\`).`);

  const proceed = await promptConfirm(
    `Set CI secrets on the "${GITHUB_ENVIRONMENT}" GitHub Environment now?`,
    true,
  );
  if (!proceed) {
    return { success: false };
  }

  note(tokenPromptBody(accountId), "Cloudflare API token");
  tryOpenInBrowser(tokenDashboardUrl(accountId));

  const token = await promptSecret("Paste the Cloudflare API token:");

  const setToken = runCommand(
    `gh secret set CLOUDFLARE_API_TOKEN --env ${GITHUB_ENVIRONMENT} --body ${shellEscape(token)}`,
  );
  if (!setToken.ok) {
    log.error(`Failed to set CLOUDFLARE_API_TOKEN: ${setToken.stderr || setToken.stdout}`);
    log.info(
      `If the "${GITHUB_ENVIRONMENT}" environment doesn't exist yet, create it first: repo Settings → Environments → New environment.`,
    );
    return { success: false };
  }

  const setAccountId = runCommand(
    `gh variable set CLOUDFLARE_ACCOUNT_ID --env ${GITHUB_ENVIRONMENT} --body ${shellEscape(accountId)}`,
  );
  if (!setAccountId.ok) {
    log.error(`Failed to set CLOUDFLARE_ACCOUNT_ID: ${setAccountId.stderr || setAccountId.stdout}`);
    return { success: false };
  }

  log.success(
    `CLOUDFLARE_API_TOKEN (secret) and CLOUDFLARE_ACCOUNT_ID (variable) are set on "${GITHUB_ENVIRONMENT}". CI deploys should work on the next push to main.`,
  );
  return { success: true };
}
