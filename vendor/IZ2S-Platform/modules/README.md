# Modules

Each `modules/<id>/` folder belongs to one application/integration. **File Exchange** is the only module bundled in the prepared public release; the test project contains additional apps. A new experimental folder is not automatically added to the release profile.

## What belongs in one folder?

| Path | Purpose |
| --- | --- |
| `module.json` | Identity, requirements, entry points and declared file inventory |
| `switch/` | Console interface/logic and resources |
| `server/` | PC-side integration and optional installers |
| `<id>.izm` | Generated portable ZIP-based package |
| `runtime/` | Extra downloaded programs or compiled helpers; private/local |
| `data/` | Private application preferences/profile |
| `.versions/<hash>/` | Verified snapshot kept fixed for a session |

The package can contain a console part, a server part or both. Only `switch.files` goes to Switch. A small integration package does not contain an entire external game or Electron runtime. Read that module's README for its extra requirements.

## Add, change and use a module

Place a valid `<id>.izm` in the matching folder. In a source checkout, edit the owned source and rebuild its package:

```sh
./tools/node sdk/pack.cjs modules/iz-exchange
./tools/node sdk/check.cjs
```

A module's README is part of the package/checksum inventory, so documentation changes need repacking too. Normal startup also publishes valid source changes. Select/load modules in the App library and open their tiles on Switch. Installing an optional PC runtime is a separate action inside its card.

An active console session keeps its verified version until it ends. Do not edit `.versions/` or session copies directly. End the session safely and use a fresh activation for updated code. The host process is ordinary user code, not a security sandbox.

The experimental display name **Thomas & Friends™: Race On!** retains module ID `grand-theft-auto-5` and its GTA integration. A display-name change does not rename its dependency/component IDs.

[File Exchange](iz-exchange/README.md) · [Module format and developer contract](../sdk/README.md) · [FAQ](../FAQ.md#modules-and-file-exchange) · [Main README](../README.md).
