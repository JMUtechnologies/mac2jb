# Native compatibility boundary

If you are looking for the server or bootstrap, edit `engines/izmysh/`, not this folder. The canonical unchanged bootstrap is `engines/izmysh/bootstrap.bas`; the engine-owned RPC client is `engines/izmysh/server/lib/rpc.cjs`.

This folder retains small compatibility paths and the engine boundary. Shared production native workers/services and calling data live under `core/console/native/`, `core/console/host/` and `core/console/abi/`. Follow a forward to its canonical implementation instead of creating a duplicate.

Input typing is owned by the selected hardware configuration. Starting a server does not start a console app automatically. Historical recovery code is owned by the engine; the ordinary bootstrap does not enable it.

[Core map](../README.md) · [Engine guide](../../engines/README.md) · [FAQ](../../FAQ.md).
