/**
 * Deployments API client (v3 Core surface).
 *
 * Wraps the public Deployment-centric endpoints introduced by the
 * takosumi Core simplification (Phase 1 § 17 spec). Every endpoint
 * lives under `/api/public/v1/`.
 *
 *   POST /api/public/v1/deployments                        # create
 *   GET  /api/public/v1/deployments/:id                    # fetch one
 *   GET  /api/public/v1/deployments?group=&status=         # list
 *   GET  /api/public/v1/groups/:group_id/head              # current head
 *   POST /api/public/v1/deployments/:id/apply              # advance to applied
 *   POST /api/public/v1/deployments/:id/approve            # attach approval
 *   POST /api/public/v1/groups/:group_id/rollback          # flip GroupHead
 */

import { api } from "../lib/api.ts";

export type DeploymentMode = "preview" | "resolve" | "apply" | "rollback";

export type DeploymentStatus =
  | "preview"
  | "resolved"
  | "applying"
  | "applied"
  | "failed"
  | "rolled-back";

export type DeploymentSourceRefType = "branch" | "tag" | "commit";

export interface DeploymentInlineArtifactFile {
  path: string;
  encoding?: "base64";
  content: string;
}

export interface DeploymentInlineArtifact {
  compute: string;
  files: DeploymentInlineArtifactFile[];
}

export type DeploymentSource =
  | {
    kind: "git";
    repository_url: string;
    ref?: string;
    ref_type?: DeploymentSourceRefType;
  }
  | {
    kind: "inline";
    artifacts: DeploymentInlineArtifact[];
  };

export interface DeploymentExpansionSummary {
  components?: number;
  routes?: number;
  bindings?: number;
  resources?: number;
  diff?: {
    create?: number;
    update?: number;
    delete?: number;
    unchanged?: number;
  };
}

export interface DeploymentCondition {
  type: string;
  status: "true" | "false" | "unknown";
  reason?: string;
  message?: string;
  observed_generation?: number;
  last_transition_time?: string;
  scope?: { kind: string; ref?: string };
}

export interface DeploymentRecord {
  id: string;
  group_id: string;
  space_id: string;
  status: DeploymentStatus;
  conditions?: DeploymentCondition[];
  input?: Record<string, unknown>;
  resolution?: Record<string, unknown>;
  desired?: Record<string, unknown>;
  policy_decisions?: Array<Record<string, unknown>>;
  approval?: Record<string, unknown> | null;
  rollback_target?: string | null;
  created_at?: string;
  applied_at?: string | null;
  finalized_at?: string | null;
  expansion_summary?: DeploymentExpansionSummary;
  hostnames?: string[];
}

export interface CreateDeploymentRequest {
  manifest?: unknown;
  source?: DeploymentSource;
  mode: DeploymentMode;
  target_id?: string;
  group?: string;
  env?: string;
}

export interface CreateDeploymentResponse {
  deployment_id: string;
  status: DeploymentStatus;
  conditions?: DeploymentCondition[];
  expansion_summary?: DeploymentExpansionSummary;
  deployment?: DeploymentRecord;
}

export interface GroupHeadRecord {
  group_id: string;
  current_deployment_id: string;
  previous_deployment_id?: string | null;
  generation?: number;
  advanced_at?: string;
}

export interface GroupHeadResponse {
  head?: GroupHeadRecord;
  group_head?: GroupHeadRecord;
}

export interface RollbackResponse {
  deployment_id: string;
  status: DeploymentStatus;
  head?: GroupHeadRecord;
  group_head?: GroupHeadRecord;
  conditions?: DeploymentCondition[];
  deployment?: DeploymentRecord;
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
 * Creates (or previews) a Deployment under the given mode.
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

/**
 * GET /api/public/v1/deployments/:id
 */
export function getDeployment(spaceId: string, deploymentId: string) {
  return api<{ deployment: DeploymentRecord }>(
    `/api/public/v1/deployments/${encodeURIComponent(deploymentId)}`,
    { headers: withSpace(spaceId) },
  );
}

/**
 * GET /api/public/v1/deployments?group=&status=
 */
export function listDeployments(
  spaceId: string,
  filters: { group?: string; status?: DeploymentStatus } = {},
) {
  const params = new URLSearchParams();
  if (filters.group) params.set("group", filters.group);
  if (filters.status) params.set("status", filters.status);
  const query = params.toString();
  const path = query
    ? `/api/public/v1/deployments?${query}`
    : `/api/public/v1/deployments`;
  return api<{ deployments: DeploymentRecord[] }>(path, {
    headers: withSpace(spaceId),
  });
}

/**
 * GET /api/public/v1/groups/:group_id/head
 */
export function getGroupHead(spaceId: string, groupId: string) {
  return api<GroupHeadResponse>(
    `/api/public/v1/groups/${encodeURIComponent(groupId)}/head`,
    { headers: withSpace(spaceId) },
  );
}

/**
 * POST /api/public/v1/deployments/:id/apply
 * Advance a resolved Deployment to applied.
 */
export function applyDeployment(
  spaceId: string,
  deploymentId: string,
  options: { timeoutMs?: number } = {},
) {
  return api<CreateDeploymentResponse>(
    `/api/public/v1/deployments/${encodeURIComponent(deploymentId)}/apply`,
    {
      method: "POST",
      body: {},
      headers: withSpace(spaceId),
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
  );
}

/**
 * POST /api/public/v1/deployments/:id/approve
 * Attach an approval record to a resolved Deployment.
 */
export function approveDeployment(
  spaceId: string,
  deploymentId: string,
  body: { policy_decision_id?: string; expires_at?: string; note?: string } =
    {},
) {
  return api<CreateDeploymentResponse>(
    `/api/public/v1/deployments/${encodeURIComponent(deploymentId)}/approve`,
    {
      method: "POST",
      body: body as Record<string, unknown>,
      headers: withSpace(spaceId),
    },
  );
}

/**
 * POST /api/public/v1/groups/:group_id/rollback
 * Atomically flip GroupHead to the previous Deployment (or to target_id if given).
 */
export function rollbackGroup(
  spaceId: string,
  groupId: string,
  body: { target_id?: string } = {},
  options: { timeoutMs?: number } = {},
) {
  return api<RollbackResponse>(
    `/api/public/v1/groups/${encodeURIComponent(groupId)}/rollback`,
    {
      method: "POST",
      body: body as Record<string, unknown>,
      headers: withSpace(spaceId),
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
  );
}

export function groupHeadFromResponse(
  response: GroupHeadResponse,
): GroupHeadRecord | undefined {
  return response.head ?? response.group_head;
}
