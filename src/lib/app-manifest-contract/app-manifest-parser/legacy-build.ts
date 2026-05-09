export function legacyBuildDisabledMessage(field: string): string {
  return `${field} is no longer supported by the Takos app manifest parser; ` +
    `resolve artifacts upstream with takosumi-git (for example: ` +
    `takosumi-git init, then takosumi-git push) and submit a Takos app ` +
    `manifest with digest-pinned image URIs.`;
}
