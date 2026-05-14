import type { Command } from "commander";
import { bold, green, red, yellow } from "@std/fmt/colors";
import {
  clearCredentials,
  getConfig,
  isContainerMode,
  saveApiUrl,
  saveToken,
  validateApiUrl,
} from "../lib/config.ts";
import { api } from "../lib/api.ts";
import { cliExit } from "../lib/command-exit.ts";
import { normalizeBaseUrl } from "../lib/cli-utils.ts";

const ACCOUNTS_TOKEN_PATH = "/v1/account/tokens";
const ACCOUNTS_PAT_SCOPES = ["read", "write", "admin"] as const;
type AccountsPatScope = typeof ACCOUNTS_PAT_SCOPES[number];

type AccountsTokenCreateResponse = {
  token?: string;
  token_record?: unknown;
  tokenRecord?: unknown;
  error?: unknown;
};

function validateAccountsBearerToken(token: string): string | null {
  const normalized = token.trim();
  if (!normalized) return "token is required";
  if (normalized.length > 4096) return "token is too long";
  if (hasWhitespaceOrControlCharacter(normalized)) {
    return "token must not contain whitespace or control characters";
  }
  if (normalized.startsWith("tak_pat_") || normalized.startsWith("tak_oat_")) {
    return "Takos app-local tokens are no longer accepted";
  }
  return null;
}

function hasWhitespaceOrControlCharacter(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f) return true;
  }
  return false;
}

function parsePatScopes(value?: string): AccountsPatScope[] {
  const rawScopes = (value ?? "read,write")
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  const scopes = rawScopes.length > 0 ? rawScopes : ["read", "write"];
  const seen = new Set<string>();
  for (const scope of scopes) {
    if (!ACCOUNTS_PAT_SCOPES.includes(scope as AccountsPatScope)) {
      throw new Error(
        `invalid PAT scope '${scope}' (expected read, write, or admin)`,
      );
    }
    seen.add(scope);
  }
  return [...seen] as AccountsPatScope[];
}

async function createAccountsPat(input: {
  accountsUrl: string;
  sessionToken: string;
  name?: string;
  scopes?: string;
}): Promise<string> {
  const accountsUrl = normalizeBaseUrl(input.accountsUrl);
  const urlValidation = validateApiUrl(accountsUrl);
  if (!urlValidation.valid) {
    throw new Error(`Invalid Accounts URL: ${urlValidation.error}`);
  }
  const sessionToken = input.sessionToken.trim();
  const tokenError = validateAccountsBearerToken(sessionToken);
  if (tokenError) {
    throw new Error(`Invalid Accounts session token: ${tokenError}`);
  }
  const response = await fetch(`${accountsUrl}${ACCOUNTS_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      name: input.name?.trim() || "takos-cli",
      scopes: parsePatScopes(input.scopes),
    }),
  });
  let body: AccountsTokenCreateResponse = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok) {
    const message = typeof body.error === "string"
      ? body.error
      : `Takosumi Accounts returned HTTP ${response.status}`;
    throw new Error(message);
  }
  if (typeof body.token !== "string") {
    throw new Error("Takosumi Accounts did not return a PAT token");
  }
  const patError = validateAccountsBearerToken(body.token);
  if (patError) {
    throw new Error(`Takosumi Accounts returned an invalid PAT: ${patError}`);
  }
  return body.token.trim();
}

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Authenticate with the Takos product")
    .option("--api-url <url>", "API URL (default: https://takos.jp)")
    .option(
      "--token <token>",
      "Takosumi Accounts PAT or bearer token to store locally",
    )
    .option(
      "--create-pat",
      "Create a Takosumi Accounts PAT with a session bearer, then store it",
    )
    .option("--accounts-url <url>", "Takosumi Accounts base URL")
    .option(
      "--session-token <token>",
      "Takosumi Accounts session bearer for --create-pat",
    )
    .option("--pat-name <name>", "Name for the created PAT")
    .option(
      "--pat-scopes <scopes>",
      "Comma-separated PAT scopes: read,write,admin (default: read,write)",
    )
    .action(async (options: {
      apiUrl?: string;
      token?: string;
      createPat?: boolean;
      accountsUrl?: string;
      sessionToken?: string;
      patName?: string;
      patScopes?: string;
    }) => {
      if (isContainerMode()) {
        console.log(
          yellow("Running in container mode - authentication is automatic"),
        );
        return;
      }

      const apiUrl = options.apiUrl || getConfig().apiUrl;

      // Validate API URL format and security
      const urlValidation = validateApiUrl(apiUrl);
      if (!urlValidation.valid) {
        console.log(red(`Invalid API URL: ${urlValidation.error}`));
        cliExit(1);
      }
      if (urlValidation.insecureLocalhostHttp) {
        console.warn(
          yellow(
            "Warning: Using insecure HTTP connection. Only use for local development.",
          ),
        );
      }

      if (options.createPat) {
        if (options.token) {
          console.log(red("--create-pat cannot be combined with --token"));
          cliExit(1);
        }
        const accountsUrl = options.accountsUrl ||
          Deno.env.get("TAKOSUMI_ACCOUNTS_URL");
        if (!accountsUrl) {
          console.log(
            red(
              "Missing Takosumi Accounts URL. Pass --accounts-url or set TAKOSUMI_ACCOUNTS_URL.",
            ),
          );
          cliExit(1);
        }
        const sessionToken = options.sessionToken ||
          Deno.env.get("TAKOSUMI_ACCOUNTS_SESSION_TOKEN");
        if (!sessionToken) {
          console.log(
            red(
              "Missing Takosumi Accounts session token. Pass --session-token or set TAKOSUMI_ACCOUNTS_SESSION_TOKEN.",
            ),
          );
          cliExit(1);
        }
        let pat: string;
        try {
          pat = await createAccountsPat({
            accountsUrl,
            sessionToken,
            name: options.patName,
            scopes: options.patScopes,
          });
        } catch (error) {
          console.log(
            red(error instanceof Error ? error.message : String(error)),
          );
          cliExit(1);
        }
        if (options.apiUrl) {
          saveApiUrl(apiUrl);
        }
        saveToken(pat);
        console.log(green("Created and stored Takosumi Accounts PAT."));
        return;
      }

      if (options.token) {
        const tokenError = validateAccountsBearerToken(options.token);
        if (tokenError) {
          console.log(red(`Invalid token: ${tokenError}`));
          cliExit(1);
        }
        if (options.apiUrl) {
          saveApiUrl(apiUrl);
        }
        saveToken(options.token.trim());
        console.log(green("Stored Takosumi Accounts bearer token."));
        return;
      }

      console.log(
        red(
          "Takos CLI browser login is retired. Create a Takosumi Accounts PAT and run `takos login --token <takpat_...>`, or use `takos login --create-pat` with an Accounts session bearer.",
        ),
      );
      cliExit(1);
    });

  program
    .command("logout")
    .description("Clear stored credentials")
    .action(() => {
      if (isContainerMode()) {
        console.log(yellow("Running in container mode - cannot logout"));
        return;
      }

      clearCredentials();
      console.log(green("Logged out successfully"));
    });

  program
    .command("whoami")
    .description("Show current user info")
    .action(async () => {
      const meResult = await api<{
        email?: string;
        name?: string;
        username?: string;
        picture?: string;
        setup_completed?: boolean;
      }>("/api/me");

      if (!meResult.ok) {
        console.log(red(`Error: ${meResult.error}`));
        cliExit(1);
      }

      const spacesResult = await api<
        { spaces: Array<{ id: string; name: string; role: string }> }
      >("/api/spaces");
      if (!spacesResult.ok) {
        console.log(red(`Error: ${spacesResult.error}`));
        cliExit(1);
      }

      const user = meResult.data;
      const spaces = spacesResult.data.spaces;

      console.log(bold("\nUser:"));
      console.log(`  Username: ${user.username || "-"}`);
      console.log(`  Email:    ${user.email || "-"}`);
      console.log(`  Name:     ${user.name || "-"}`);
      console.log(
        `  Setup:    ${user.setup_completed ? "completed" : "incomplete"}`,
      );

      if (spaces.length > 0) {
        console.log(bold("\nSpaces:"));
        for (const space of spaces) {
          console.log(`  ${space.name} (${space.role})`);
        }
      }
    });
}
