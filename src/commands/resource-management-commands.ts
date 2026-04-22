import type { Command } from "commander";
import { green } from "@std/fmt/colors";
import { fail, withCommandError } from "./resource-helpers.ts";
import {
  attachResourceToGroup,
  createOnlineResource,
  deleteOnlineResourceForCommand,
  detachResourceFromGroup,
  listOnlineResourcesForCommand,
  printNamedResourceApiResponse,
  printResourceList,
  requestResourceByIdApi,
  resolveResourceType,
  type ResourceCreateCommandOptions,
  type ResourceDeleteCommandOptions,
  type ResourceJsonCommandOptions,
  type ResourceListCommandOptions,
  type ResourceTargetOptions,
  VALID_RESOURCE_TYPES,
  withResolvedBindingTarget,
} from "./resource-core.ts";

export function registerCreateCommand(resourceCmd: Command) {
  resourceCmd
    .command("create <name>")
    .description("Create a new resource")
    .option(
      "--type <type>",
      `Resource type (${VALID_RESOURCE_TYPES.join(", ")})`,
    )
    .option("--binding <binding>", "Suggested binding name")
    .option("--env <env>", "Target environment", "staging")
    .option("--group <name>", "Attach the resource to a group")
    .option("--space <id>", "Target space ID")
    .option("--json", "Machine-readable JSON output")
    .action(async (name: string, options: ResourceCreateCommandOptions) => {
      let resourceType;
      try {
        resourceType = resolveResourceType({ type: options.type });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }

      await withCommandError("Failed to create resource", async () => {
        await createOnlineResource(name, resourceType, options);
      })();
    });
}

export function registerGroupAttachmentCommands(resourceCmd: Command) {
  resourceCmd
    .command("attach <name>")
    .description("Attach a resource to a group")
    .requiredOption("--group <name>", "Target group name")
    .option("--space <id>", "Target space ID")
    .action(
      withCommandError(
        "Failed to attach resource",
        async (name: string, options: { group: string; space?: string }) => {
          await attachResourceToGroup(name, options);
        },
      ),
    );

  resourceCmd
    .command("detach <name>")
    .description("Detach a resource from its group")
    .option("--space <id>", "Target space ID")
    .action(
      withCommandError(
        "Failed to detach resource",
        async (name: string, options: { space?: string }) => {
          await detachResourceFromGroup(name, options);
        },
      ),
    );
}

export function registerListShowDeleteCommands(resourceCmd: Command) {
  resourceCmd
    .command("list")
    .description("List resources in a space")
    .option("--space <id>", "Target space ID")
    .option("--json", "Machine-readable JSON output")
    .action(async (options: ResourceListCommandOptions) => {
      await withCommandError("Failed to list resources", async () => {
        const resources = await listOnlineResourcesForCommand(options);
        printResourceList(resources, "No resources found.", options.json);
      })();
    });

  resourceCmd
    .command("show <name>")
    .description("Show a resource")
    .option("--space <id>", "Target space ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      withCommandError(
        "Failed to show resource",
        async (name: string, options: ResourceJsonCommandOptions) => {
          await printNamedResourceApiResponse(name, options);
        },
      ),
    );

  resourceCmd
    .command("delete <name>")
    .description("Delete a resource")
    .option("--space <id>", "Target space ID")
    .action(async (name: string, options: ResourceDeleteCommandOptions) => {
      await withCommandError("Failed to delete resource", async () => {
        await deleteOnlineResourceForCommand(name, options);
      })();
    });
}

export function registerBindingCommands(resourceCmd: Command) {
  resourceCmd
    .command("bind <name>")
    .description("Bind a resource to a worker or service")
    .requiredOption(
      "--binding <binding>",
      "Binding name to expose inside the workload",
    )
    .option("--worker <name>", "Target worker slug/name")
    .option("--service <name>", "Target service slug/name")
    .option(
      "--group <name>",
      "Resolve a group-managed workload by manifest name",
    )
    .option("--space <id>", "Target space ID")
    .action(
      withCommandError(
        "Failed to bind resource",
        async (
          name: string,
          options: ResourceTargetOptions & { binding: string },
        ) => {
          await withResolvedBindingTarget(name, options, async ({
            resource,
            target,
          }) => {
            await requestResourceByIdApi(resource.id, "/bind", {
              method: "POST",
              body: {
                service_id: target.id,
                binding_name: options.binding,
              },
            });
            console.log(
              green(
                `Bound '${name}' to '${
                  target.slug ?? target.id
                }' as ${options.binding}.`,
              ),
            );
          });
        },
      ),
    );

  resourceCmd
    .command("unbind <name>")
    .description("Remove a resource binding from a worker or service")
    .option("--worker <name>", "Target worker slug/name")
    .option("--service <name>", "Target service slug/name")
    .option(
      "--group <name>",
      "Resolve a group-managed workload by manifest name",
    )
    .option("--space <id>", "Target space ID")
    .action(
      withCommandError(
        "Failed to unbind resource",
        async (name: string, options: ResourceTargetOptions) => {
          await withResolvedBindingTarget(name, options, async ({
            resource,
            target,
          }) => {
            await requestResourceByIdApi(
              resource.id,
              `/bind/${encodeURIComponent(target.id)}`,
              { method: "DELETE" },
            );
            console.log(
              green(`Unbound '${name}' from '${target.slug ?? target.id}'.`),
            );
          });
        },
      ),
    );
}
