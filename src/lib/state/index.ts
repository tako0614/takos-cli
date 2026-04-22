export type {
  ContainerState,
  ResourceState,
  RouteState,
  ServiceState,
  TakosState,
  WorkerState,
} from "./state-types.ts";

export type { StateAccessOptions } from "./state-file.ts";

export {
  deleteStateFile,
  deleteStateFromFile,
  getStateDir,
  getStateFilePath,
  listStateGroups,
  listStateGroupsFromFile,
  readState,
  // File-based helpers (for tests / explicit offline mode)
  readStateFromFile,
  writeState,
  writeStateToFile,
} from "./state-file.ts";

export { getDefaultSpaceId, hasApiEndpoint } from "./api-client.ts";
