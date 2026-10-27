# ARM PC Only

This combined server/input preset is currently disabled. Its descriptor is a future topology, not verified general ARM support. Individual apps can have x64-only requirements. Do not expect selecting metadata or moving folders to install OS-specific USB gadget support.

`profile.json` describes roles, links, displayed fields and whether the preset is selectable. `entry.cjs` connects it to the relevant checks/input transport. Discovery reads metadata; it does not install or execute a device driver automatically.

[Hardware overview](../../README.md) · [ARM package guide](../../agents/arm-input/README.md) · [FAQ](../../../FAQ.md#arm-board-and-usb-keyboard).
