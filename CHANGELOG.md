# Changelog

All notable changes to `takos-cli` are recorded here.

## Unreleased

- Documented the current Installation install boundary: `takos install` remains
  a guidance-only command that exits nonzero and points app creation to
  `takosumi install` / the Takosumi installer API or Takosumi Accounts install
  APIs.
- Clarified `takos installations` ledger inspection help for
  `TAKOSUMI_ACCOUNTS_URL`, `TAKOSUMI_ACCOUNTS_TOKEN`, and locally stored
  `takpat_...` credentials from `takos login --token`.
- Synced help / docs with the 仕様策定中 narrative: 5-endpoint installer API now
  uses 409 (TOCTOU) / 413 (oversize) status only, no idempotency-key header;
  replay protection is achieved via `expected.commit` /
  `expected.manifestDigest` pinning from the previous dry-run response.
- Wave N RFC-6 X3 docs sync: Clarified that takos-cli handles **two distinct
  contract scopes**, and that `build:` field handling differs per scope.
  README.md / AGENTS.md now explicitly distinguish (1) the **app-manifest
  contract** (`src/lib/app-manifest-contract/`, `manifest.yml` / `manifest.yaml`
  consumed by `takos group desired`), which fail-closed rejects
  `compute.<name>.build:` and `overrides.compute.<name>.build:` via
  `buildMetadataDisabledMessage`, from (2) the **`.takosumi.yml` AppSpec path**
  (`src/commands/deploy.ts:isAppSpec()`), which only validates envelope shape
  (`apiVersion: "v1"`, `metadata.id` / `metadata.name`, `components` object) and
  opaquely pass-through `components.*` field content (including `build:`) to the
  GitOps deploy-intent gateway. AppSpec contract field-level validation is a
  downstream `packages/installer/` responsibility, so Wave N removal of
  `Component.build` (= takosumi
  [RFC 0001](https://takosumi.com/docs/rfc/0001-kernel-kind-agnostic),
  Component.build deletion + curated 4-kind catalog retirement + kernel pure
  contract executor) is absorbed upstream without changing the CLI surface.
  Added a comment to `test/deploy.test.ts` explaining why the test fixture
  legitimately contains `components.gateway.build:` (= it is an AppSpec-scope
  fixture, not an app-manifest-scope fixture).
