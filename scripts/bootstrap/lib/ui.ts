import { cancel, confirm, isCancel, note, password } from "@clack/prompts";

export type ToolRowStatus = "ready" | "failed" | "deferred" | "skipped";

export interface ToolRow {
  label: string;
  status: ToolRowStatus;
  detail?: string;
}

const STATUS_GLYPH: Record<ToolRowStatus, string> = {
  ready: "✔",
  failed: "✖",
  deferred: "—",
  skipped: "·",
};

export function printToolTable(title: string, rows: ToolRow[]): void {
  if (rows.length === 0) return;
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const lines = rows.map((r) => {
    const detail = r.detail ?? "";
    return `${STATUS_GLYPH[r.status]}  ${r.label.padEnd(labelWidth)}  ${detail}`;
  });
  note(lines.join("\n"), title);
}

export async function promptOrExit<T>(
  promise: Promise<T>,
  cancelMessage = "Bootstrap cancelled.",
): Promise<T> {
  const result = await promise;
  if (isCancel(result)) {
    cancel(cancelMessage);
    process.exit(1);
  }
  return result;
}

export async function promptConfirm(message: string, initialValue: boolean): Promise<boolean> {
  const result = await promptOrExit(confirm({ message, initialValue }));
  return result === true;
}

/** Masked prompt for secrets — never echoed, never logged. */
export async function promptSecret(message: string): Promise<string> {
  const result = await promptOrExit(
    password({
      message,
      validate: (value) => ((value ?? "").trim().length === 0 ? "Required" : undefined),
    }),
  );
  return result as string;
}
