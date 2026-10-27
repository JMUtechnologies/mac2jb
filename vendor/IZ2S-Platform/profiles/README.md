# Configuration API and compatibility entries

This folder is an API layer for hardware configurations. It is **not** where personal Steam, game, YouTube or controller profiles are stored.

The real device/configuration implementations live in `hardware/`: one device folder, one ready topology folder or one input transport per responsibility. `index.cjs` exposes those settings/configurations. `adapters/` retains small compatibility entry points for existing callers.

Choose **PC + ARM PC** in the panel; the other supplied Linux topologies are currently disabled previews. Add a new device or transport in its hardware folder rather than copying a driver into this API folder.

[Hardware guide](../hardware/README.md) · [Folder map and backups](../FAQ.md#files-folders-and-backups) · [Main README](../README.md).
