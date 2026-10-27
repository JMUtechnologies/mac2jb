# Session control

## Read this before retrying a failure

A session is the live connection, not just an open browser page. Source installation, saving, a full restart and a new launch are distinct steps. Disconnect safely requests orderly cleanup; ! STOP is an emergency action, not a power cycle. If input cancellation or native cleanup is uncertain, do not start a second overlapping attempt.

[Main README](../../README.md) · [Plain-English FAQ](../../FAQ.md)

The panel owns installation, launch, cancellation and history. Engines own bootstrap and qualified transport. Shells own the console renderer; application modules own their services.

## Installation

The default PC + ARM PC configuration checks host, input device, USB control link and console network. All checks and a fresh-screen acknowledgement are required before sending input. Device inspection does not write HID reports. The user selects an empty source slot 0–3; LIST and SAVE use that slot. Source review, optional three-part checksum comparison, Save and restart confirmation are separate actions. The source check is not a cryptographic readback.

Launch uses the engine's saved name and a newly generated START command. It loads into slot 0, runs the bootstrap and performs memory preparation once. A failed attempt requires a full console restart before retrying. Hardware adapters execute explicit engine plans; they do not own copies of bootstrap code.

## Ownership and stopping

Module controls open in adjacent browser tabs. Closing the browser keeps the server/session alive; reopening the launcher returns to the existing panel. **Disconnect safely** requests ordinary cleanup. **! STOP** cancels pending starts, terminates the owned runner process group and separately requests input cancellation. New launch stays blocked while cancellation is unconfirmed. This button does not power-cycle Switch; restart the console manually after a hard stop.

Private attempt logs, session state and local keys belong under data/. Application profiles stay in their module folders. Logs redact private access keys; the platform does not automatically record screens or raw audio.

## Rendering and input

Streaming services own capture, codec, audio and dynamic ports. TV mode is queried separately from network transport; being docked does not prove Ethernet is active. Transition/resume closes the stream visibility gate until a fresh verified frame arrives. Old frames and old profile results are discarded. Controllers remain connected to Switch; the host exposes a virtual gamepad from forwarded input.

See [controller mailbox and rendering gate](controller-hub.md), [historical recovery experiment](connection-recovery.md), and [capability evidence](../../sdk/docs/capabilities.md). Historical measurements are not validation of the current release. Local preview/tests do not install or run console code.
