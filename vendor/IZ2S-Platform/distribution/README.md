# Release preparation and testing

This folder explains how finished experimental changes become a small distributable release. It does not contain another running console server.

| File | Purpose |
| --- | --- |
| `profile.json` | Release scope: File Exchange, IZMYSH and optional engine adapters |
| `README-release.md` | Template for the release's root README |
| `README-development.md` | Step-by-step Git, preview, container and VM guide |
| `export.py` | Reads committed lab files and applies the release allowlist |
| `workflow.py` | Prepare/review/verify/accept a candidate; never pushes automatically |
| `verify.cjs`, `build.cjs` | Check source and create a clean runtime archive |
| `install.sh` | Installer template, copied to the release root |
| `preview.cjs`, `preview.sh` | Temporary interface preview |
| `test-install.sh` | Temporary installation without system/shortcut changes |
| `Containerfile`, `container.sh`, `container-entry.cjs` | Optional isolated Linux installer/preview recipe |

Developer scripts exist in the source repositories; the minimal runtime archive omits them but retains the user guides, installer and preview. Generating an archive does not install it or restart the current test panel. Keep `data/`, module runtimes, downloaded original engines and credentials out of public artifacts.

Start with the [development guide](README-development.md). For the plain-English explanation of the two repositories and what Git does, see [FAQ](../FAQ.md#git-and-release-work). [Back to main README](../README.md).
