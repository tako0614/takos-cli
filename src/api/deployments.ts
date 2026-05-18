/**
 * Deploy-intent API client for the current Takos CLI surface.
 *
 * The CLI writes local AppSpec GitOps deploy intents through the browser/CLI
 * gateway. App lifecycle operations are owned by Takosumi Accounts
 * AppInstallation APIs and the Takosumi installer, not Deployment follow-up
 * routes.
 */

import { api } from "../lib/api.ts";

export interface CreateDeploymentRequest {
  appSpec?: unknown;
  mode: "apply";
  group?: string;
  env?: string;
}

export interface CreateDeploymentResponse {
  accepted: true;
  mode: "gitops";
  intent: {
    id: string;
    driver: "gitops";
    branch: string;
    path: string;
    commit?: string;
  };
}

const DEFAULT_TIMEOUT_MS = 120_000;

function withSpace(
  spaceId: string,
  headers?: Record<string, string>,
): Record<string, string> {
  return {
    ...(headers ?? {}),
    "X-Takos-Space-Id": spaceId,
  };
}

/**
 * POST /api/public/v1/deployments
 * Writes a GitOps deploy intent from an explicit local AppSpec.
 */
export function createDeployment(
  spaceId: string,
  body: CreateDeploymentRequest,
  options: { timeoutMs?: number } = {},
) {
  return api<CreateDeploymentResponse>(
    `/api/public/v1/deployments`,
    {
      method: "POST",
      body,
      headers: withSpace(spaceId),
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
  );
}
