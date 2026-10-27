# Shared platform services

`core/` contains behavior genuinely shared by the platform: extension/package checks, session bookkeeping, console services and module lifecycle. It is not the place for a second copy of an engine or a particular game's launch code.

| Folder / entry | Responsibility |
| --- | --- |
| `session/` | Install/launch/stop state, history, source-slot selection and session records |
| `console/host/` | Shared qualified console services such as file access and sampled input |
| `console/native/`, `console/abi/` | Native call workers, function/signature data and agreed memory layouts |
| `native/` | Compatibility paths and engine boundary; not another bootstrap |
| `archive.cjs`, `modules.cjs` | Module packaging/verification and installed module catalog |
| `host-modules.cjs` | Starts/stops owned PC-side module processes |
| `services/` | Shared entry points; some are small compatibility forwards |

Follow a forwarding file to its canonical implementation before editing. A streaming module owns its own codec/listeners, and an engine owns its own bootstrap/RPC transport. Host modules run under the user's account; a child process is not an OS sandbox.

Private output belongs in the platform/module data folders, not in committed runtime source. [Session guide](session/README.md) · [FAQ](../FAQ.md) · [Main README](../README.md).
