/**
 * Configuration management for takos-cli
 *
 * Three modes (checked in order):
 * 1. Environment auth: TAKOS_SESSION_ID or TAKOS_TOKEN, plus optional TAKOS_SPACE_ID
 * 2. Session file: .takos-session in current directory (session workdir)
 * 3. External mode: ~/.takos/config.json, plus optional TAKOS_SPACE_ID
 */

// Re-export public API from split modules
export type { ApiUrlValidationResult } from "./config-validation.ts";
export { validateApiUrl } from "./config-validation.ts";

export type { TakosConfig } from "./config-auth.ts";
export {
  clearCredentials,
  getConfig,
  isAuthenticated,
  isContainerMode,
  saveApiUrl,
  saveToken,
} from "./config-auth.ts";

export { getApiRequestTimeoutMs, getLoginTimeoutMs } from "./config-timeout.ts";
