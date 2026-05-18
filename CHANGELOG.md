# Changelog

All notable changes to `takos-cli` are recorded here.

## Unreleased

- Documented the current AppInstallation install boundary: `takos install`
  remains a guidance-only command that exits nonzero and points app creation to
  `takosumi install` / the Takosumi installer API or Takosumi Accounts install
  APIs.
- Clarified `takos installations` ledger inspection help for
  `TAKOSUMI_ACCOUNTS_URL`, `TAKOSUMI_ACCOUNTS_TOKEN`, and locally stored
  `takpat_...` credentials from `takos login --token`.
