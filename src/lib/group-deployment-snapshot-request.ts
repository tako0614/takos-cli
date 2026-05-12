/**
 * @deprecated v2 deployment-snapshot client.
 *
 * The v2 deploy paths and the snapshot record were removed by the
 * Core v3 unification. Deployment lifecycle now flows through the public v3
 * deployments family rooted at `/api/public/v1/deployments`.
 *
 * This module is retained as a thin re-export of the v3 deployments client so
 * that any remaining import sites fail closed at type-check time rather than
 * silently calling deleted endpoints. New code MUST import directly from
 * `../api/deployments.ts`.
 */

export {
  applyDeployment,
  approveDeployment,
  createDeployment,
  getDeployment,
  getGroupHead,
  listDeployments,
  rollbackGroup,
} from "../api/deployments.ts";

export type {
  CreateDeploymentRequest,
  CreateDeploymentResponse,
  DeploymentCondition,
  DeploymentExpansionSummary,
  DeploymentMode,
  DeploymentRecord,
  DeploymentStatus,
  GroupHeadRecord,
  RollbackResponse,
} from "../api/deployments.ts";
