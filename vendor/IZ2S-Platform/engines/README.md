# Server engines

## Choosing a connection method

An engine entry in the panel can exist before its server is installed. IZMYSH is included. For the three optional engines, use the download button or put the complete original repository in its own upstream folder and check it. Keep each engine's saved bootstrap and freshly generated connection command together; similar filenames do not make sources interchangeable.

[Main README](../README.md) · [Plain-English FAQ](../FAQ.md)

IZMYSH is the only bundled engine. Its folder owns the bootstrap, installation recipe, standalone server, native RPC and platform adapter. The pepsipu and kurumuz adapters remain available, with empty `upstream/` installation folders. Their original sources are optional downloads and are not included by default.

The panel discovers engine descriptors without executing them. Each engine owns its source checksum, save name, slot recipe, network ABI and Original behavior. The platform does not reconstruct START arguments. Compatible shells attach through the session contract; Original remains an engine mode.

`engines/index.cjs` manages discovery and version pinning; `common.cjs` provides launch-plan helpers; `host.cjs` attaches a compatible transport to platform services. Application code and hardware input transports stay outside engine folders.

Optional engine installation is explicit: select the engine in Original mode, download the pinned upstream revision, or open `engines/<id>/upstream/` and copy the complete repository manually. Check manual folder validates required files and the original bootstrap checksum. IZlauncher is supported by IZMYSH and kurumuz. The kurumuz Original menu retains the optional `--rpc` checkbox.

All adapters default to program slot 0; LIST and SAVE follow explicit user selection. The panel warns before source entry because slot contents and an existing named save can be overwritten. Manual source detection rebinds an idle session handler; it never replaces a running session. Upstream server sources are read and pinned without rewriting their code.
