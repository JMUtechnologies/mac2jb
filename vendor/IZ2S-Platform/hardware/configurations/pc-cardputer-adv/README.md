# PC + Cardputer ADV

This separate input-device preset is currently disabled. It describes a future Linux PC → Cardputer ADV/KProx → Switch topology. A device-specific firmware/API endpoint and actual USB input qualification are required; the Linux ARM input package is not Cardputer firmware.

`profile.json` describes roles, links, displayed fields and whether the preset is selectable. `entry.cjs` connects it to the relevant checks/input transport. Discovery reads metadata; it does not install or execute a device driver automatically.

[Hardware overview](../../README.md) · [ARM package guide](../../agents/arm-input/README.md) · [FAQ](../../../FAQ.md#arm-board-and-usb-keyboard).
