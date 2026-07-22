#!/usr/bin/env tsx
/**
 * TransitMapper Bootstrap CLI
 *
 * Usage:
 *   pnpm bootstrap
 *
 * Phases (in order), scoped down to what transitmapper actually needs
 * today:
 *   auth               — confirm gh + wrangler are logged in
 *   cloudflare-verify   — confirm the D1 database and custom domain route
 *                         from apps/worker/wrangler.toml actually exist
 *   ci-secrets          — set CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
 *                         on the "production" GitHub Environment
 *
 * No resumable state file and no install/workspace/env/repo/domain phases
 * yet — add them once there's a concrete need (e.g. a second contributor
 * needs local dev tool checks). This same phase-array pattern (a plain
 * array of { id, title, run } run in sequence, `note()`-driven UX via
 * @clack/prompts) is also used by the org's other Cloudflare-deployed
 * project, github.com/LasVegansForTransit/website, in its own
 * scripts/bootstrap/ — kept consistent across projects intentionally
 * rather than each repo inventing its own onboarding-CLI shape.
 */
import { intro, outro } from "@clack/prompts";
import { runAuthPhase } from "./phases/auth.js";
import { runCloudflareVerifyPhase } from "./phases/cloudflare-verify.js";
import { runCiSecretsPhase } from "./phases/ci-secrets.js";

interface Phase {
  id: string;
  title: string;
  run: () => Promise<{ success: boolean }>;
}

const PHASES: readonly Phase[] = [
  { id: "auth", title: "CLI authentication", run: runAuthPhase },
  { id: "cloudflare-verify", title: "Cloudflare deployment config", run: runCloudflareVerifyPhase },
  { id: "ci-secrets", title: "CI secrets", run: runCiSecretsPhase },
];

async function main(): Promise<void> {
  intro("TransitMapper bootstrap");

  for (const phase of PHASES) {
    const result = await phase.run();
    if (!result.success) {
      outro(`Stopped at "${phase.title}" — fix the issue above and re-run \`pnpm bootstrap\`.`);
      process.exit(1);
    }
  }

  outro("Bootstrap complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
