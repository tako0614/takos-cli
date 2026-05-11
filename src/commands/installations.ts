import process from "node:process";
import type { Command } from "commander";
import { bold, dim, red } from "@std/fmt/colors";
import {
  getApiRequestTimeoutMs,
  getConfig,
  validateApiUrl,
} from "../lib/config.ts";
import { CliCommandExit, cliExit } from "../lib/command-exit.ts";

type InstallationSource = {
  type?: string;
  url?: string;
  ref?: string | null;
  commit?: string | null;
};

type AppInstallationSummary = {
  id?: string;
  account_id?: string;
  space_id?: string;
  app_id?: string;
  source?: InstallationSource;
  mode?: string;
  runtime_binding_id?: string | null;
  billing_account_id?: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
};

type AppInstallationListResponse = {
  installations?: AppInstallationSummary[];
};

type AppInstallationInspectResponse = {
  installation?: AppInstallationSummary;
  bindings?: unknown[];
  grants?: unknown[];
  runtime_binding?: unknown | null;
  oidc_client?: unknown | null;
  tracking?: {
    events_url?: string;
  };
};

type AccountsErrorEnvelope = {
  error?: unknown;
  error_description?: unknown;
  message?: unknown;
  details?: unknown;
};

type AccountsCommandOptions = {
  accountsUrl?: string;
  token?: string;
  json?: boolean;
};

type InstallationListOptions = AccountsCommandOptions & {
  space?: string;
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function resolveAccountsUrl(value?: string): string {
  const raw = value ?? Deno.env.get("TAKOSUMI_ACCOUNTS_URL");
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      "Missing Takosumi Accounts URL. Pass --accounts-url or set TAKOSUMI_ACCOUNTS_URL.",
    );
  }
  const accountsUrl = normalizeBaseUrl(raw);
  const validation = validateApiUrl(accountsUrl);
  if (!validation.valid) {
    throw new Error(`Invalid Takosumi Accounts URL: ${validation.error}`);
  }
  return accountsUrl;
}

function resolveAccountsBearer(value?: string): string {
  const raw = value ?? Deno.env.get("TAKOSUMI_ACCOUNTS_TOKEN") ??
    getConfig().token;
  const token = raw?.trim() ?? "";
  if (!token) {
    throw new Error(
      "Missing Takosumi Accounts bearer. Pass --token, set TAKOSUMI_ACCOUNTS_TOKEN, or run `takos login --token <takpat_...>`.",
    );
  }
  const validationError = validateAccountsBearerToken(token);
  if (validationError) {
    throw new Error(`Invalid Takosumi Accounts bearer: ${validationError}`);
  }
  return token;
}

function validateAccountsBearerToken(token: string): string | null {
  if (!token.trim()) return "token is required";
  if (token.length > 4096) return "token is too long";
  for (const char of token) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f) {
      return "token must not contain whitespace or control characters";
    }
  }
  if (token.startsWith("tak_pat_") || token.startsWith("tak_oat_")) {
    return "legacy Takos app-local tokens are no longer accepted";
  }
  return null;
}

async function accountsRequest<T>(
  path: string,
  options: AccountsCommandOptions,
): Promise<T> {
  const accountsUrl = resolveAccountsUrl(options.accountsUrl);
  const token = resolveAccountsBearer(options.token);
  const controller = new AbortController();
  const timeoutMs = getApiRequestTimeoutMs();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${accountsUrl}${path}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      signal: controller.signal,
    });
    const body = await readJsonBody(response);
    if (!response.ok) {
      throw new Error(
        extractAccountsError(
          body,
          `Takosumi Accounts returned HTTP ${response.status}`,
        ),
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Takosumi Accounts request timed out after ${timeoutMs}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    if (response.ok) {
      throw new Error("Takosumi Accounts returned invalid JSON");
    }
    return {};
  }
}

function extractAccountsError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const envelope = body as AccountsErrorEnvelope;
  for (
    const value of [
      envelope.error,
      envelope.error_description,
      envelope.message,
      envelope.details,
    ]
  ) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (
      value && typeof value === "object" &&
      typeof (value as { message?: unknown }).message === "string" &&
      (value as { message: string }).message.trim()
    ) {
      return (value as { message: string }).message.trim();
    }
  }
  return fallback;
}

function resolveSpaceId(value?: string): string {
  const spaceId = value ?? getConfig().spaceId;
  if (!spaceId || spaceId.trim().length === 0) {
    throw new Error("Missing space id. Pass --space or set TAKOS_SPACE_ID.");
  }
  return spaceId.trim();
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function valueOrDash(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "-";
}

function pad(value: string, width: number): string {
  return value.length >= width
    ? value
    : `${value}${" ".repeat(width - value.length)}`;
}

function renderInstallationSummary(
  installation: AppInstallationSummary,
): string {
  const id = valueOrDash(installation.id);
  const status = valueOrDash(installation.status);
  const app = valueOrDash(installation.app_id);
  const mode = valueOrDash(installation.mode);
  const ref = valueOrDash(
    installation.source?.ref ?? installation.source?.commit,
  );
  return `  ${pad(id, 22)} ${pad(status, 12)} ${pad(app, 26)} ${
    pad(mode, 13)
  } ${ref}`;
}

function renderInstallationInspect(body: AppInstallationInspectResponse): void {
  const installation = body.installation ?? {};
  console.log("");
  console.log(bold(`Installation: ${valueOrDash(installation.id)}`));
  console.log(`  App:             ${valueOrDash(installation.app_id)}`);
  console.log(`  Status:          ${valueOrDash(installation.status)}`);
  console.log(`  Space:           ${valueOrDash(installation.space_id)}`);
  console.log(`  Account:         ${valueOrDash(installation.account_id)}`);
  console.log(`  Mode:            ${valueOrDash(installation.mode)}`);
  console.log(
    `  Source:          ${valueOrDash(installation.source?.url)}#${
      valueOrDash(installation.source?.ref ?? installation.source?.commit)
    }`,
  );
  console.log(
    `  Runtime binding: ${valueOrDash(installation.runtime_binding_id)}`,
  );
  console.log(
    `  Billing account: ${valueOrDash(installation.billing_account_id)}`,
  );
  console.log(`  Created:         ${valueOrDash(installation.created_at)}`);
  console.log(`  Updated:         ${valueOrDash(installation.updated_at)}`);
  console.log("");
  console.log(`  Bindings:        ${body.bindings?.length ?? 0}`);
  console.log(`  Grants:          ${body.grants?.length ?? 0}`);
  if (body.oidc_client) console.log("  OIDC client:     registered");
  if (body.runtime_binding) console.log("  Runtime target:  registered");
  if (body.tracking?.events_url) {
    console.log(`  Events:          ${body.tracking.events_url}`);
  }
  console.log("");
}

export async function runInstallationsList(
  options: InstallationListOptions,
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const body = await accountsRequest<AppInstallationListResponse>(
    `/v1/installations?space_id=${encodeURIComponent(spaceId)}`,
    options,
  );
  if (options.json) {
    writeJson(body);
    return;
  }
  const installations = body.installations ?? [];
  if (installations.length === 0) {
    console.log(dim(`No installations found for space ${spaceId}.`));
    return;
  }
  console.log("");
  console.log(bold(`Installations for ${spaceId}:`));
  console.log(
    dim(
      `  ${pad("ID", 22)} ${pad("STATUS", 12)} ${pad("APP", 26)} ${
        pad("MODE", 13)
      } REF`,
    ),
  );
  for (const installation of installations) {
    console.log(renderInstallationSummary(installation));
  }
  console.log("");
  console.log(dim(`${installations.length} installation(s)`));
}

export async function runInstallationsInspect(
  installationId: string,
  options: AccountsCommandOptions,
): Promise<void> {
  const normalizedId = installationId.trim();
  if (!normalizedId) throw new Error("installation id is required");
  const body = await accountsRequest<AppInstallationInspectResponse>(
    `/v1/installations/${encodeURIComponent(normalizedId)}`,
    options,
  );
  if (options.json) {
    writeJson(body);
    return;
  }
  renderInstallationInspect(body);
}

function handleCommandError(error: unknown): void {
  if (error instanceof CliCommandExit) throw error;
  console.log(red(error instanceof Error ? error.message : String(error)));
  cliExit(1);
}

export function registerInstallationsCommand(program: Command): void {
  const installations = program
    .command("installations")
    .description("Inspect Takosumi Accounts AppInstallation ledger records");

  installations
    .command("list")
    .description("List AppInstallations for a space")
    .option("--accounts-url <url>", "Takosumi Accounts base URL")
    .option("--token <token>", "Takosumi Accounts bearer token or PAT")
    .option("--space <id>", "Target space ID")
    .option("--json", "Machine-readable JSON output")
    .action(async (options: InstallationListOptions) => {
      try {
        await runInstallationsList(options);
      } catch (error) {
        handleCommandError(error);
      }
    });

  installations
    .command("inspect <installationId>")
    .description("Inspect one AppInstallation")
    .option("--accounts-url <url>", "Takosumi Accounts base URL")
    .option("--token <token>", "Takosumi Accounts bearer token or PAT")
    .option("--json", "Machine-readable JSON output")
    .action(async (installationId: string, options: AccountsCommandOptions) => {
      try {
        await runInstallationsInspect(installationId, options);
      } catch (error) {
        handleCommandError(error);
      }
    });
}
