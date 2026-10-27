# PC + ARM PC

This is the enabled default: Linux PC server → ARM USB keyboard input → Switch 2. Connect PC and ARM over the network; connect the ARM data/OTG USB port to Switch. Use First-time setup to deploy/check the ARM agent separately from installing the PC panel.

`profile.json` describes roles, links, displayed fields and whether the preset is selectable. `entry.cjs` connects it to the relevant checks/input transport. Discovery reads metadata; it does not install or execute a device driver automatically.

[Hardware overview](../../README.md) · [ARM package guide](../../agents/arm-input/README.md) · [FAQ](../../../FAQ.md#arm-board-and-usb-keyboard).
