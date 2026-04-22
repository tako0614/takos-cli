import { api } from "./api.ts";

export type GroupDeploymentSnapshotSource = Record<string, unknown>;

export type GroupDeploymentSnapshotApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type GroupDeploymentSnapshotRequestBody = {
  env: string;
  source: GroupDeploymentSnapshotSource;
  group_name?: string;
  target?: string[];
};

export function buildGroupDeploymentSnapshotRequestBody(options: {
  env: string;
  source: GroupDeploymentSnapshotSource;
  groupName?: string;
  target?: string[];
}): GroupDeploymentSnapshotRequestBody {
  return {
    env: options.env,
    source: options.source,
    ...(options.groupName ? { group_name: options.groupName } : {}),
    ...(options.target && options.target.length > 0
      ? { target: options.target }
      : {}),
  };
}

export function requestGroupDeploymentSnapshotPlan<T>(
  spaceId: string,
  body: GroupDeploymentSnapshotRequestBody,
  timeout = 120_000,
): Promise<GroupDeploymentSnapshotApiResponse<T>> {
  return api<T>(`/api/spaces/${spaceId}/group-deployment-snapshots/plan`, {
    method: "POST",
    body,
    timeout,
  });
}

export function requestGroupDeploymentSnapshotMutation<T>(
  spaceId: string,
  body: GroupDeploymentSnapshotRequestBody,
  timeout = 120_000,
): Promise<GroupDeploymentSnapshotApiResponse<T>> {
  return api<T>(`/api/spaces/${spaceId}/group-deployment-snapshots`, {
    method: "POST",
    body,
    timeout,
  });
}
