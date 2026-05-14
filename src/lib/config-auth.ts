/**
 * Authentication mode resolution and token management.
 *
 * Session file I/O lives in ./config-session-io.ts.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { logWarning } from "./cli-log.ts";
import { isValidId, validateApiUrl } from "./config-validation.ts";
import {
  findSessionFile,
  isWindows,
  setSecurePermissions,
} from "./config-session-io.ts";

export interface TakosConfig {
  apiUrl: string;
  token?: string;
  sessionId?: string;
  spaceId?: string;
}

type ConfStore = { token?: string; apiUrl?: string };

function getConfigDir(): string {
  return Deno.env.get("TAKOS_CONFIG_DIR") || join(homedir(), ".takos");
}

function getConfigFile(): string {
  return join(getConfigDir(), "config.json");
}

function parseConfStore(value: unknown): ConfStore {
  if (
    value === null || typeof value !== "object" || Array.isArray(value)
  ) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const store: ConfStore = {};
  if (typeof record.token === "string") {
    store.token = record.token;
  }
  if (typeof record.apiUrl === "string") {
    store.apiUrl = record.apiUrl;
  }
  return store;
}

function readConfStore(): ConfStore {
  try {
    return parseConfStore(JSON.parse(readFileSync(getConfigFile(), "utf-8")));
  } catch {
    return {};
  }
}

function writeConfStore(store: ConfStore): void {
  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true });
  writeFileSync(getConfigFile(), JSON.stringify(store, null, 2));
}

const PRODUCTION_DOMAIN = "takos.jp";

export const DEFAULT_API_URL = `https://${PRODUCTION_DOMAIN}`;

/**
 * Validate space ID from env var and return it, or throw on invalid format.
 */
function validateEnvSpaceId(): string | undefined {
  const spaceId = Deno.env.get("TAKOS_SPACE_ID");
  if (spaceId && !isValidId(spaceId)) {
    logWarning("SECURITY WARNING: TAKOS_SPACE_ID has invalid format");
    logWarning("Expected UUID v4 or alphanumeric ID (1-64 characters)");
    throw new Error("Invalid TAKOS_SPACE_ID format");
  }
  return spaceId;
}

/**
 * Validate TAKOS_API_URL as an endpoint override independent of auth mode.
 * Returns undefined when the override is not set.
 */
function validateEnvApiUrlOverride(): string | undefined {
  const apiUrl = Deno.env.get("TAKOS_API_URL");
  if (!apiUrl) return undefined;

  logWarning(`Using custom API URL from environment: ${apiUrl}`);
  const domainValidation = validateApiUrl(apiUrl);
  if (!domainValidation.valid) {
    logWarning(`SECURITY WARNING: ${domainValidation.error}`);
    throw new Error(`Invalid TAKOS_API_URL: ${domainValidation.error}`);
  }
  return apiUrl;
}

// Check if running inside takos container (env var or session file)
export function isContainerMode(): boolean {
  return !!Deno.env.get("TAKOS_SESSION_ID") || !!Deno.env.get("TAKOS_TOKEN") ||
    findSessionFile() !== null;
}

// Get configuration based on mode
export function getConfig(): TakosConfig {
  // 1. Check environment variables first
  if (Deno.env.get("TAKOS_SESSION_ID")) {
    logWarning("Using environment variable authentication (TAKOS_SESSION_ID)");

    const sessionId = Deno.env.get("TAKOS_SESSION_ID")!;
    if (!isValidId(sessionId, 8)) {
      logWarning("SECURITY WARNING: TAKOS_SESSION_ID has invalid format");
      logWarning("Expected UUID v4 or alphanumeric ID (8-64 characters)");
      throw new Error("Invalid TAKOS_SESSION_ID format");
    }

    const spaceId = validateEnvSpaceId();
    return {
      apiUrl: validateEnvApiUrlOverride() ?? DEFAULT_API_URL,
      sessionId,
      spaceId,
    };
  }

  // 1b. Environment token mode (TAKOS_TOKEN)
  if (Deno.env.get("TAKOS_TOKEN")) {
    logWarning("Using environment variable authentication (TAKOS_TOKEN)");

    const spaceId = validateEnvSpaceId();
    return {
      apiUrl: validateEnvApiUrlOverride() ?? DEFAULT_API_URL,
      token: Deno.env.get("TAKOS_TOKEN"),
      spaceId,
    };
  }

  // 2. Check for .takos-session file
  const sessionFile = findSessionFile();
  if (sessionFile) {
    const apiUrl = validateEnvApiUrlOverride() ??
      (sessionFile.api_url || DEFAULT_API_URL);
    return {
      apiUrl,
      sessionId: sessionFile.session_id,
      spaceId: sessionFile.space_id,
    };
  }

  // 3. External mode - read from config file
  const store = readConfStore();
  const envApiUrl = validateEnvApiUrlOverride();
  const configuredApiUrl = store.apiUrl;
  let validatedApiUrl = envApiUrl ?? DEFAULT_API_URL;
  if (!envApiUrl && configuredApiUrl) {
    const domainValidation = validateApiUrl(configuredApiUrl);
    if (!domainValidation.valid) {
      logWarning(
        `SECURITY WARNING: Ignoring invalid apiUrl in config: ${domainValidation.error}`,
      );
      logWarning(`Falling back to default API URL: ${DEFAULT_API_URL}`);
    } else {
      validatedApiUrl = configuredApiUrl;
    }
  }

  const spaceId = validateEnvSpaceId();
  return {
    apiUrl: validatedApiUrl,
    token: store.token,
    spaceId,
  };
}

// Save token to config (external mode only)
export function saveToken(token: string): void {
  if (isContainerMode()) {
    throw new Error("Cannot save token in container mode");
  }

  // Ensure config directory exists with secure permissions (0o700 for directories)
  const configDir = getConfigDir();
  const configFile = getConfigFile();

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    if (!isWindows()) {
      try {
        chmodSync(configDir, 0o700);
      } catch {
        logWarning(
          `Failed to set secure permissions on config directory: ${configDir}`,
        );
      }
    }
  }

  const store = readConfStore();
  store.token = token;
  writeConfStore(store);

  if (existsSync(configFile)) {
    setSecurePermissions(configFile);
  }
}

// Save API URL to config
export function saveApiUrl(apiUrl: string): void {
  if (isContainerMode()) {
    throw new Error("Cannot save config in container mode");
  }

  const normalizedApiUrl = apiUrl.trim();
  const domainValidation = validateApiUrl(normalizedApiUrl);
  if (!domainValidation.valid) {
    throw new Error(`Invalid API URL: ${domainValidation.error}`);
  }

  const store = readConfStore();
  store.apiUrl = normalizedApiUrl;
  writeConfStore(store);
}

// Clear stored credentials
export function clearCredentials(): void {
  if (isContainerMode()) {
    throw new Error("Cannot clear credentials in container mode");
  }

  writeConfStore({});
}

// Check if authenticated
export function isAuthenticated(): boolean {
  const config = getConfig();
  return !!(config.token || config.sessionId);
}
