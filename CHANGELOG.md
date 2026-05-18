# Changelog

All notable changes to `takos-cli` are recorded here.

## Unreleased

- Documented the current Installation install boundary: `takos install`
  remains a guidance-only command that exits nonzero and points app creation to
  `takosumi install` / the Takosumi installer API or Takosumi Accounts install
  APIs.
- Clarified `takos installations` ledger inspection help for
  `TAKOSUMI_ACCOUNTS_URL`, `TAKOSUMI_ACCOUNTS_TOKEN`, and locally stored
  `takpat_...` credentials from `takos login --token`.
- Synced help / docs with the 仕様策定中 narrative: 5-endpoint installer API now
  uses 409 (TOCTOU) / 413 (oversize) status only, no idempotency-key header;
  replay protection is achieved via `expected.commit` / `expected.manifestDigest`
  pinning from the previous dry-run response.
