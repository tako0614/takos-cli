# takos-cli

Japanese: [README.ja.md](README.ja.md)

Standalone repository for the Takos CLI.

`takos-cli` is the task-oriented command-line interface for the Takos platform. This repository contains the CLI source, tests, and the minimum vendored contracts needed to keep the CLI buildable outside the `takos/` monorepo.

## What This Repo Owns

- authentication and endpoint selection for the Takos API
- task-oriented API commands such as `workspace`, `repo`, `thread`, `run`, and `resource`
- manifest-oriented commands such as `plan` and `apply`
- local state inspection and refresh commands
- CLI-specific Cloudflare deploy adapters and formatters

## Repository Layout

- `src/`: CLI implementation
- `test/`: CLI tests
- `vendor/takos-control/`: vendored manifest and deploy contracts required by the CLI
- `vendor/takos-actions-engine/`: vendored workflow parser and validator used for manifest validation
- `shims/`: runtime shims for packaging compatibility

## Requirements

- Deno 2.x

## Quickstart

```bash
cd takos-cli
deno task test
deno task start -- --help
```

Compile a local binary:

```bash
cd takos-cli
deno task compile
```

## Installation

Until a dedicated registry release flow is set up, use the compiled binary or run directly with Deno.

```bash
deno run --allow-all src/index.ts --help
```

## Key Commands

Authentication:

```bash
takos login
takos whoami
takos logout
```

Endpoint switching:

```bash
takos endpoint use test
takos endpoint use prod
takos endpoint show
```

Manifest-oriented flow:

```bash
takos plan
takos apply --env staging
takos apply --env production
```

## Standalone Notes

- This repo vendors the minimum Takos contracts required to avoid a hard dependency on the `takos/` workspace.
- The in-tree `takos/apps/cli` copy may remain temporarily for runtime image compatibility while the broader migration is completed.
- If the manifest schema or deploy contract changes upstream, update the vendored contract files here in the same change window.

## License

GNU AGPL v3
