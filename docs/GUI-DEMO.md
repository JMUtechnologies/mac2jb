# mac2jb GUI

mac2jb v0.4.3 provides the ns2jb workflow, HBLauncher, OunceCake game-content
export and an experimental Stremio-compatible player. A completed Mac-side transfer does not prove that
the console accepted the input or that ns2jb succeeded; the host independently
verifies execution, restoration and cleanup.

This release includes the fork's exact five-argument bootstrap and matching
START command. Replace an older saved nine-argument NS2 before using it.
See the [mandatory migration instructions](../README.md#required-replace-the-old-bootstrap).
Bootstrap progress shows each line as it starts typing and advances the
completed count after that line finishes.

## Run the app

On an Apple Silicon Mac running macOS 14 or newer, download [the v0.4.3 app ZIP](https://github.com/cpypwn/mac2jb/releases/download/v0.4.3/mac2jb-v0.4.3-macos-arm64.zip), extract it and open mac2jb.app. Its executable bundles the sender tools, Node.js runtime, host source, bootstrap, unsigned USB driver, and notices. The app also includes HBLauncher v0.2.0, ftpd-sb v0.1.0, OunceCake, and the required companion tools and fonts. You do not need a Pico, a separate Python or Node.js installation, Xcode, or command-line tools to run the prepared app. It extracts its embedded payload into a private session folder.

The app is ad hoc signed, not Developer ID signed or notarized. If a downloaded copy is blocked by Gatekeeper, try opening it, then use System Settings → Privacy & Security → Open Anyway, if macOS offers it. See [Apple’s guidance for opening an app from an unidentified developer](https://support.apple.com/en-us/102445). Do not change kernel-security settings to address a Gatekeeper app warning.

To build your own copy from this source checkout, run:

```sh
bash scripts/build-gui.sh
open build/mac2jb.app
```

`make gui` is the optional shortcut for the build. Building requires Apple Silicon, Xcode Command Line Tools, and the official standalone Node.js v24.22.1 runtime. The build uses `/usr/local/bin/node` by default; set `NODE_BINARY` to another v24.22.1 executable if needed. Running the resulting application does not require these tools. The existing CLI workflow remains `make` followed by `bash mac2jb.command`. The existing CLI remains available alongside the GUI.

The HBLauncher package includes Python 3.13.17, Pillow 13.0.0,
SPIRV-Tools 2026.4, and DejaVu Sans 2.37. See the
[packaging notices](../packaging/NOTICE.md) for attribution; these dependencies
are included in the prepared app.

## What the GUI handles

Select the Mac’s IPv4 address on the same network as the Switch. The GUI keeps the host and its current pairing values together, selects a USB controller automatically, and sends the post-bootstrap commands. Install & load driver… installs the bundled unsigned driver through an administrator prompt, preserves an existing driver in a backup, and requests loading. Complete Recovery settings first, then any approval/restart prompts. For the full game, the extra Enter for SmileBASIC’s `LOAD` confirmation is included. Demo mode uses `LOADV` without that confirmation Enter. The expected Out of memory response after `REMOVE` is part of the upstream procedure.

### Choose a mode before starting

SmileBASIC edition: I’m using the SmileBASIC demo appears immediately below
Type bootstrap only. This checkbox is off by
default and remembered between launches. Select it for the demo; leave it
unchecked for the full game. The selected edition stays fixed during a run.

Held RPC is the first option and selected by default because all homebrew tools require it. Type bootstrap only comes next for initial setup, followed by System-code dump and NS2JB exploit only. Restart the console before every exploit run, then prepare SmileBASIC for the selected choice:

| Choice | What happens |
| --- | --- |
| Held RPC | Loads the saved `NS2`, sends RUN, REMOVE and START, then keeps the verified connection open for homebrew. Keep mac2jb and SmileBASIC open. Choose Finish session when done. |
| Type bootstrap only | Types the exact fork bootstrap into an empty SmileBASIC program editor. When typing finishes, manually save it using the commands for your selected edition, confirm the save prompt and return to the start screen. It does not save automatically, start a host or run the exploit. |
| System-code dump | Runs the same saved-bootstrap exploit sequence, captures accessible installed system-program `main` and `main.npdm` files with an inventory and hashes, then releases resources and finishes automatically. Choose Open dump folder after completion. |
| NS2JB exploit only | Loads the saved new `NS2`, sends RUN, REMOVE, and this host's START command, verifies execution and restoration, then releases resources and finishes. It does not hold RPC open and cannot launch homebrew. |

For Type bootstrap only, open SmileBASIC → Make a Program with an empty
editor before starting. Allow approximately 7–10 minutes at the default typing
speed. Wait until typing finishes, then enter Direct mode. The full game
uses `SAVE "NS2"` with the bootstrap in slot 0. In the demo, manually enter these
two commands in order:

```basic
PRGEDIT 0
SAVEV "TXT:NS2", PRGGET$()
```

The GUI's save prompt shows the commands for the selected edition; it does not
perform the save. After saving, confirm the prompt and return to the start
screen. Restart the console before starting another choice.

For demo exploit modes, mac2jb loads the saved bootstrap with this single line:

```basic
PRGEDIT 0:LOADV "TXT:NS2" OUT C$:PRGSET C$
```

It then sends `RUN`, `REMOVE`, and the matching five-argument START command.
Demo `LOADV` skips the full game's LOAD-confirmation Enter. The full-game path
continues to use `LOAD "TXT:NS2"` and its confirmation.

The maintainer has confirmed manual demo save/load. Automated GUI demo loading
still needs a console test. Saving the bootstrap does not retain the exploit
or RPC connection; each exploit attempt needs a fresh console and host session.

For the other three choices, first save the fork's new five-argument bootstrap as `NS2` in slot 0. Restart the console → open SmileBASIC → enter Direct mode, use Ethernet for the Switch 2 until Wi-Fi support is confirmed, select the Mac's IPv4 address on that network, then start. These choices use the saved program and do not type the bootstrap again.

The selected operation proceeds automatically after 4/4 verification; there is no later options prompt. A dump uses a new private folder and requires at least 512 MiB free on the Mac. Captures cover accessible system-program code, not a full NAND image. Keep SmileBASIC and mac2jb open until the selected operation and final cleanup finish. A failed capture retains partial files and is not automatically retried; keep the output and logs, then restart the console before another attempt.

The sidebar tracks the selected flow and current attempt. After a failure or cancellation, Prepare becomes active again and the interrupted step shows an X. Returning to Prepare does not repeat typing automatically.

Automatic USB selection tries the tested controllers 0, 1, and 3. Choose another controller manually if your Mac uses a different mapping. A retry is allowed only before typing begins. After a partial bootstrap, inspect and clear the editor before trying again. If post-bootstrap commands have started, or an exploit attempt fails or is cancelled, restart the console before another attempt. Do not send `REMOVE` twice in the same application process.

The timing controls let you tune key pacing, each controller’s enumeration timeout, and the waits between commands. Defaults are 50 ms per key, 4 seconds per controller, 1 second before confirming LOAD, and 3 seconds after LOAD, RUN, and REMOVE. The key-delay range is 1–2,000 ms, the enumeration range is 1–120 seconds, and each command wait accepts 0–120,000 ms. These changes apply to the GUI sender; the existing CLI keeps its original options and timing. The progress display counts bootstrap lines, command steps, and waiting time; it does not infer console execution from a timer.

The GUI cannot inspect the Switch screen, verify a saved program, operate macOS Recovery, grant kernel-extension approval, or guarantee exploit success. Keep the console focused and the USB cable connected. Only the host’s verified result establishes FS execution verified, including restoration and cleanup; keyboard transfer completed means only that the HID sender finished.

## Homebrew

Start a fresh Held RPC session using the new saved `NS2`. Once 4/4 succeeds,
choose Launch HBLauncher under Homebrew requires Held RPC
to start the bundled HBLauncher v0.2.0 through that same live connection. Keep mac2jb and SmileBASIC open. The app supplies the launcher,
apps, runtime, and companion tools; no Pico or second bootstrap is needed.
HBLauncher can be launched only once in each held session.

HBLauncher runs GPU apps through SmileBASIC. When done, finish the session and
restart the console before another run. Stopping the launcher does not establish
that every retained GPU allocation was released. After a failed or interrupted
launch, keep the logs and restart before trying again. See
[the Homebrew guide](HOMEBREW.md).

The bundle also includes ftpd-sb v0.1.0. In HBLauncher, select Refresh, open ftpd-sb, and press A to start. See [the FileZilla connection guide](FTPD-SB.md) for the console IP, passive anonymous FTP, and storage scope.

To add apps, use Open session logs, then open vendor → HBLauncher → apps
and copy in each complete prebuilt app folder. Return to the launcher menu and
select Refresh. See [app installation and persistence](HOMEBREW.md#adding-hblauncher-apps).

For game-content export, enter the Switch IP address in OunceCake from a fresh
Held RPC session and choose Open game list. Choose a game, then Start FTP. After FTP is ready, connect to the Switch 2's IP
on port `2121` with plain anonymous FTP, passive mode and Binary/Image (TYPE I)
transfers. This read-only game-content server is separate from ftpd-sb on port
`5000`. See the [OunceCake guide](OUNCECAKE.md) for steps and output limits.

Alternatively, choose Launch Stremio directly from a fresh Held RPC session.
Only one homebrew application can be launched per session. Stremio must be
installed on the Mac; see the [player guide](STREMIO-EXPERIMENTAL.md) for supported
media, account features and controls.


## Before a first run

1. Have an Apple Silicon Mac, a data-capable USB-C cable, and the compatible console software. The project’s tested combination is Switch 2 system software 23.0.1 and SmileBASIC 4.4.9, with more than 20 MiB free in the SmileBASIC save.
2. macOS must permit the bundled unsigned driver. Fully disabled SIP is the maintainer-tested setup; compatible partial/custom configurations are accepted. If your driver already loads, keep your configuration. Otherwise follow the [documented driver setup](../README.md#install-the-bundled-usb-driver-recommended), complete approval/restart prompts, and refresh the loaded-driver check. The GUI never changes SIP, AMFI, or Recovery settings.
3. Click Install & load driver…, approve the administrator prompt, complete macOS approval if requested, and restart. The tested unsigned driver is bundled; Xcode is not required. The previous CLI also supports `bash mac2jb.command --install-driver`. See [driver setup and source-build fallback](../README.md#install-the-bundled-usb-driver-recommended).
4. Put the Mac and Switch on the same reachable local network. Ethernet is likely required for the Switch 2; Wi-Fi has not yet been verified with this setup. Select that network’s Mac IPv4 address, and allow the host through macOS networking/firewall prompts if requested. The host uses TCP port 39380. Use a data-capable cable and check the USB power direction: on the tested hardware, enumeration failed when the Mac was charging the Switch. If the Switch shows that it is charging from the Mac, disconnect and reconnect the cable before retrying. A charging indicator does not prove that the keyboard data connection is working.
5. Preserve compatible console software before testing. Follow the [README’s 90DNS guidance](../README.md#highly-recommended-protect-the-required-software-versions), including its regional IPv4 addresses and IPv6 instructions, on the network connection used for testing.
6. On the Switch 2, set System Settings → Controllers & Accessories → USB Keyboard → US English. This is required for bootstrap typing and post-bootstrap commands. The Mac's physical keyboard/input layout does not affect mac2jb's US-layout USB keycodes. If `#` appeared as `£` or letters were substituted, correct the console setting, clear the corrupted bootstrap, and resend it; you do not need to edit `sender.c`.

Once a compatible driver is installed, approved, and loaded, the prepared application removes the need to build senders, install Node.js, open Terminal windows, copy pairing commands, or choose a controller by trial and error at the command line. The console-side preparation and verification checkpoints remain necessary.

Install & load driver… refreshes the restart marker on every installation,
even when the driver is loaded. Complete the requested restart after the latest
install, then refresh the loaded-driver check. Avoid reinstalling just to check
status; another install creates another restart requirement. This policy is
unchanged.

An unexpected USB helper crash is separate from a missing driver. Keep the
reported helper name, signal and selected controller, the macOS crash report,
and the folder opened by Open session logs. Repeated driver installation
does not resolve a helper crash. Preserve the existing recovery rule: inspect
and clear any partial bootstrap before retrying, and restart the console after
post-bootstrap commands begin or an exploit attempt fails.

## GUI updates

v0.4.3 is available through Check for Updates or the
[current app ZIP](https://github.com/cpypwn/mac2jb/releases/download/v0.4.3/mac2jb-v0.4.3-macos-arm64.zip).
Older clients can offer this higher version; they cannot be forced to update
remotely. This version supports required updates for future releases: a known
required update blocks new sessions while existing sessions can finish. Updates
still require your download and installation actions; nothing installs silently.

Use mac2jb → Check for Updates…, or leave Check for Updates Automatically enabled. Optional update notices respect that toggle and the six-hour check interval. Required-update policy is checked at every stable launch and daily while open, even with optional checks off. A known requirement remains in effect if a later check or download fails; a network failure alone does not create a requirement. Choose Download update and, after the current session/driver work finishes, Restart & update. The app verifies the download and app bundle, keeps a backup of the old app, and reopens the new version. A failed replacement restores the old app; errors show the private updater log path.

Updating affects the app only. Drivers, Recovery settings, and existing session logs are left in place. Your app folder must be writable; macOS security checks remain in effect. The updater trusts the public mac2jb GitHub repository over HTTPS and validates GitHub digests and the release checksum file; the app remains ad-hoc signed. If your older app has no updater, download v0.4.3 manually. The CLI is updated separately.

## Session data and distribution

Each GUI launch uses a private session folder under the user’s Application Support directory. Its `gui-session.log`, `host-session.log`, `usb-session.log`, and the upstream host’s own run files are retained for diagnosis, including after a failure. Activity and logs preserve full pairing commands. A failure dialog shows the exact diagnostic log path and an Open logs button. If preparation fails before the normal session folder is ready, the app attempts to save a private diagnostic log in the macOS temporary directory instead; the dialog reports if no log could be saved.

Session data is excluded from Git and release packaging. Run folders may include console memory captures and machine-specific information beyond the pairing command, so review those files before sharing a complete run folder. Stop the session before removing its data. Cancellation stops the processes belonging to that GUI session; it cannot undo keystrokes already delivered or replace a console restart.

The application includes the runtime notices; the accompanying source preserves mac2jb’s MIT license, upstream MIT/APSL notices and modified source, and pinned ns2jb source/provenance. The root license does not relicense those components. The tested unsigned kernel extension is included in both the app and complete source archive; prior session logs are excluded.
