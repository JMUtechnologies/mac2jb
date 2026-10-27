# Hardware modules

## Start here

This is where device support belongs. The currently enabled setup uses three devices: a Linux PC server, an ARM input board and Switch. Read the ARM guide before expecting USB-C to work: the board must already support a keyboard gadget. Discovery and USB are separate checks. New hardware descriptions do not install drivers or prove physical compatibility.

[Main README](../README.md) · [Plain-English FAQ](../FAQ.md)

`hardware/devices/<id>/device.json` describes one device. `hardware/configurations/<id>/profile.json` and `entry.cjs` describe one ready configuration. Deployable code lives in `agents/arm-input/`, with the ready archive under `packages/`. Shared execution adapters live in `transports/<id>/`; physical checks live in `checks.cjs` and `device-checks.cjs`. `profiles/` exposes configuration and compatibility APIs only. Model-specific logic belongs to its device folder.

## Roles and topology

| Layout | Physical devices | Interface checks |
|---|---|---|
| Separate | Server → input device → console | Server, input, control link, console: 4 |
| Combined | Server + input → console | Combined host, control link, console: 3 |

Configurations declare `nodes`, roles and `links`. Each of `server`, `input` and `console` must be assigned exactly once. A node may combine server/input. Device metadata publishes roles, capabilities, settings fields and transport. Fields are composed from the selected devices. `ui` can supply labels and check presentation without panel conditions based on configuration IDs. Unknown transports are rejected rather than treated as SSH.

**PC + ARM PC** is first and selectable by default. The other two supplied configurations have `selectable: false` and a Coming soon explanation; selecting them is rejected by both the UI and settings API. A previously saved unavailable selection falls back to PC + ARM PC while preserving its saved fields. Descriptor `order` controls catalog order.

The supplied Linux/ARM descriptions are Linux PC, ARM USB gadget, combined ARM host, Cardputer ADV/KProx and Switch 2, plus an experimental Apple Silicon description. This is not a promise of support for every ARM board. USB gadget requires an actual UDC and suitable OS; physical input needs separate verification.

## Incremental expansion

1. For a model using an existing protocol, add a device folder with its ID, name, requirements and fields. No panel or core change is required. Discovery reads JSON only and caches parsing by file modification time and size.
2. For a ready topology, add a configuration folder assigning device roles and links. Reuse adapters instead of copying drivers. Search helps locate a preset in a large catalog.
3. For a new protocol, place an adapter inside the device folder and specify relative `transport.entry`. It exports `create(options)` and returns `inspect()`, `performPlan(...)`, `halt(id)`. Discovery does not execute it; configuration activation loads it. Shared adapters support ssh-gadget, local-gadget and kprox-http.
4. Publish capabilities independently of model names. A future topology builder can filter compatible servers, input devices and consoles by role rather than listing every possible combination. A new console still needs a compatible engine; metadata alone does not implement one.
5. Add tests without hardware first, then qualify each physical model. Descriptor API versions and driver versions are independent. Invalid descriptors appear as catalog errors without breaking other entries.

Implemented: catalog, role/link checks, pluggable adapters, composed settings fields and 3/4-check layouts. A full arbitrary visual topology builder and network store are future work. Ready presets can already be added by folder without editing the panel.

The ARM package has its own manifest, checksums, installer and detailed [first-use guide](agents/arm-input/README.md). The panel offers explicit SSH and manual installation. Connection checks never deploy code.

The experimental Mac + Switch implementation by cpypwn is retained in `configurations/mac2jb/`, but is hidden and unavailable in the panel. Its source remains untested; it does not forward IZM modules or rewrite the original bootstrap. Previously saved Mac selections fall back to PC + ARM PC.
