# Console shells

A shell is the console menu attached after a compatible engine connects. **IZlauncher** is the supplied shell. **Original** means running an engine's original workflow; it is not a second shell folder.

`izlauncher/` owns the menu resources, console shaders and host adapter. Its `server/` folder runs on the PC; the compiled shaders/resources are presented on Switch. The displayed version comes from this shell's resources, not just the browser sidebar.

Do not edit a module's private game/capture behavior here. Standalone apps live in `modules/<id>/`; compatible shell contributions are declared by their module metadata. Uninstalled contributions must not initialize just because a package exists on the PC.

Keep the agreed console ABI stable when changing rendering. A verified running session stays pinned to its version; new files apply to a fresh activation. [Module guide](../modules/README.md) · [SDK](../sdk/README.md) · [FAQ](../FAQ.md).
