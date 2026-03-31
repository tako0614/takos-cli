/**
 * GitHub Actions 互換のワークフロー定義
 */

import type {
  ConcurrencyConfig,
  Job,
  JobDefaults,
  Permissions,
} from "./workflow-job-models.ts";
import type { WorkflowTrigger } from "./workflow-trigger-models.ts";

/**
 * 完全なワークフロー定義
 */
export interface Workflow {
  name?: string;
  on: WorkflowTrigger | string | string[];
  env?: Record<string, string>;
  jobs: Record<string, Job>;
  permissions?: Permissions;
  concurrency?: string | ConcurrencyConfig;
  defaults?: JobDefaults;
}
