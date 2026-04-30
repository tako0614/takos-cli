/**
 * Shared CLI-side type definitions for apply / deployment record results.
 *
 * These mirror the apply result shapes returned by the deploy backend and are
 * used by CLI commands that POST to `/api/deploy/plans` and
 * `/api/deploy/apply-runs`.
 *
 * Defining the types here keeps the CLI free of any dependency on the
 * retired local state/apply coordinator modules.
 */

export type DiffAction = "create" | "update" | "delete" | "unchanged";

export interface DiffEntry {
  name: string;
  category: "worker" | "container" | "service" | "route";
  action: DiffAction;
  type?: string;
  reason?: string;
}

export interface DiffSummary {
  create: number;
  update: number;
  delete: number;
  unchanged: number;
}

export interface DiffResult {
  entries: DiffEntry[];
  hasChanges: boolean;
  summary: DiffSummary;
}

export interface ApplyEntryResult {
  name: string;
  category: string;
  action: string;
  status: "success" | "failed";
  error?: string;
}

export interface ApplyResult {
  applied: ApplyEntryResult[];
  skipped: string[];
}
