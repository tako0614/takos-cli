/**
 * Shared formatting helpers for Deployment-centric CLI output.
 *
 * These utilities accept the v3 Deployment / CreateDeploymentResponse shapes
 * returned by `/api/public/v1/deployments*` and render them for the human
 * (non-JSON) output paths in the deploy / apply / diff / approve / rollback
 * subcommands.
 */

import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import type {
  CreateDeploymentResponse,
  DeploymentCondition,
  DeploymentExpansionSummary,
  DeploymentRecord,
  DeploymentStatus,
  GroupHeadRecord,
} from "./deployments.ts";

const STATUS_PALETTE: Record<DeploymentStatus, (s: string) => string> = {
  preview: dim,
  resolved: cyan,
  applying: yellow,
  applied: green,
  failed: red,
  "rolled-back": yellow,
};

function colorizeStatus(status: DeploymentStatus | string): string {
  const fn = STATUS_PALETTE[status as DeploymentStatus];
  return fn ? fn(status) : status;
}

export function formatExpansionSummary(
  summary: DeploymentExpansionSummary | undefined,
): string | null {
  if (!summary) return null;
  const parts: string[] = [];
  if (typeof summary.components === "number") {
    parts.push(`components=${summary.components}`);
  }
  if (typeof summary.routes === "number") {
    parts.push(`routes=${summary.routes}`);
  }
  if (typeof summary.bindings === "number") {
    parts.push(`bindings=${summary.bindings}`);
  }
  if (typeof summary.resources === "number") {
    parts.push(`resources=${summary.resources}`);
  }
  if (summary.diff) {
    const diff = summary.diff;
    const create = diff.create ?? 0;
    const update = diff.update ?? 0;
    const del = diff.delete ?? 0;
    const unchanged = diff.unchanged ?? 0;
    parts.push(
      `diff=+${create}/~${update}/-${del} (unchanged=${unchanged})`,
    );
  }
  return parts.length > 0 ? parts.join("  ") : null;
}

export function printDeploymentHeader(
  response: CreateDeploymentResponse,
  options: { title?: string } = {},
): void {
  const title = options.title ?? "Deployment";
  console.log("");
  console.log(bold(`${title}:`));
  console.log(`  ID:        ${response.deployment_id}`);
  console.log(`  Status:    ${colorizeStatus(response.status)}`);
  const summary = formatExpansionSummary(response.expansion_summary);
  if (summary) console.log(`  Expansion: ${summary}`);
  printConditions(response.conditions);
}

export function printDeploymentRecord(
  record: DeploymentRecord,
  options: { title?: string } = {},
): void {
  const title = options.title ?? "Deployment";
  console.log("");
  console.log(bold(`${title}:`));
  console.log(`  ID:        ${record.id}`);
  if (record.group_id) console.log(`  Group:     ${record.group_id}`);
  console.log(`  Status:    ${colorizeStatus(record.status)}`);
  if (record.created_at) console.log(`  Created:   ${record.created_at}`);
  if (record.applied_at) console.log(`  Applied:   ${record.applied_at}`);
  const summary = formatExpansionSummary(record.expansion_summary);
  if (summary) console.log(`  Expansion: ${summary}`);
  if (record.hostnames && record.hostnames.length > 0) {
    console.log(`  URL:       https://${record.hostnames[0]}`);
    console.log(`  Hostnames: ${record.hostnames.join(", ")}`);
  }
  if (record.rollback_target) {
    console.log(`  Rollback:  from ${record.rollback_target}`);
  }
  if (record.approval) {
    const approver = (record.approval as { approved_by?: string }).approved_by;
    if (approver) console.log(`  Approver:  ${approver}`);
  }
  printConditions(record.conditions);
}

export function printGroupHead(head: GroupHeadRecord): void {
  console.log("");
  console.log(bold("GroupHead:"));
  console.log(`  Group:     ${head.group_id}`);
  console.log(`  Current:   ${head.current_deployment_id}`);
  if (head.previous_deployment_id) {
    console.log(`  Previous:  ${head.previous_deployment_id}`);
  }
  if (typeof head.generation === "number") {
    console.log(`  Gen:       ${head.generation}`);
  }
  if (head.advanced_at) {
    console.log(`  Advanced:  ${head.advanced_at}`);
  }
}

function printConditions(
  conditions: readonly DeploymentCondition[] | undefined,
): void {
  if (!conditions || conditions.length === 0) return;
  console.log("");
  console.log(bold("Conditions:"));
  for (const condition of conditions) {
    const status = condition.status === "true"
      ? green("true")
      : condition.status === "false"
      ? red("false")
      : yellow("unknown");
    const reason = condition.reason ? ` ${dim(`(${condition.reason})`)}` : "";
    console.log(`  ${condition.type}: ${status}${reason}`);
    if (condition.message) console.log(`    ${dim(condition.message)}`);
  }
}
