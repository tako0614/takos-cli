export function retiredBuildDisabledMessage(field: string): string {
  return `${field} is not part of the Takos app manifest contract; ` +
    `submit a manifest with digest-pinned image URIs.`;
}
