# Advanced mac2jb guide

For first-time setup, follow the [main README](../README.md). This guide keeps
the terminal workflow, build instructions, detailed troubleshooting and source
information in one place. File paths and commands below use the repository root.

## Build requirements

The terminal tools require Xcode Command Line Tools and Node.js 22 or newer.
Building the GUI uses the pinned runtime and dependencies in the
[GUI build guide](GUI-DEMO.md#run-the-app). Full Xcode is needed only for the
kernel-extension source-build fallback.

To build the GUI, run `make gui` and open `build/mac2jb.app`. The prepared GUI
already includes its runtime and tools; these build tools are not needed to
run a downloaded app.

## Bundled driver details

The prebuilt unsigned driver is at `drivers/usbgadget.kext`. Its source project
is `vendor/macos_usb_gadget_poc/usbgadget/usbgadget.xcodeproj`. You do not need
to compile or sign the bundled copy. See [driver provenance and checksums](../drivers/README.md).

The installer checks the bundled driver's SHA-256 hashes, installs it at
`/Library/Extensions/usbgadget.kext` with `root:wheel` ownership, and requests
loading with `kmutil`. An existing driver is moved to a uniquely named backup;
its path is printed in activity/logs. The installer does not change SIP or
Recovery settings. Every installation records a new restart requirement, even
if a driver is already loaded; refresh status instead of repeatedly reinstalling.

`make` builds the command-line utilities, not the kernel extension. It does
not install or approve the driver.

## Terminal launcher

The terminal launcher provides the full-game bootstrap workflow and a shortcut for retrying an existing saved bootstrap. From the repository root:

```sh
bash mac2jb.command
```

Its startup menu offers:

```text
1) Full install (bootstrap + post-bootstrap)
2) Post-bootstrap only
3) Quit
4) Install & load bundled USB driver
```

Option 1 — Full install: Open SmileBASIC → Make a Program with an empty editor. Wait until the entire bootstrap has finished typing, then inspect the program, press X to return to Direct mode, and save it as `NS2` in slot 0 before pressing Enter. The launcher then starts the ns2jb host in a separate Terminal window and waits for the current session’s pairing command before transmitting post-bootstrap commands.

Bootstrap transfer time: The bundled bootstrap is 8,084 characters over 229 lines. At the default `--delay-ms 50`, typing typically takes about 7–10 minutes, including USB overhead and indentation adjustments. This is an estimate, not a hard timeout. After enumeration succeeds, leave the Terminal window open and the cable connected until typing completes.

Option 2 — Post-bootstrap only: With the fork's new five-argument bootstrap saved as `NS2` in slot 0, restart the console → open SmileBASIC → Make a Program → enter Direct mode. The launcher skips the bootstrap transfer, starts a new ns2jb host session, and automatically sends `LOAD "TXT:NS2"` followed by the remaining post-bootstrap commands.

Option 4 — Install & load bundled USB driver: Installs the included unsigned `usbgadget.kext`, preserves any existing driver in a backup, and requests loading. Configure macOS to permit the unsigned driver; compatible custom SIP configurations are accepted. Complete any macOS approval prompts and restart before choosing option 1 or 2. You can also run `bash mac2jb.command --install-driver` directly.

The launcher opens the ns2jb host in another Terminal window and waits for its current session’s `V=START(...)` pairing command before submitting the post-bootstrap commands. They are sent in this order:

```basic
LOAD "TXT:NS2"
RUN
REMOVE NSR,&H60000000,&H3FFFFFFF
V=START(...)
```

After the `LOAD` command, SmileBASIC asks the user to confirm loading `NS2`. The updated command sender transmits an additional Enter to accept the highlighted YES option before sending `RUN`. The `Out of memory` response to `REMOVE` is expected. The `V=START(...)` command is printed by the active ns2jb host; the example above is a placeholder.

### USB selection and timeouts

The launcher attempts the tested controllers (`usb-drd0`, `usb-drd1`, `usb-drd3`) and identifies each attempt in the terminal. The intended automatic enumeration timeout is 4 seconds per controller; once HID transfer starts, the enumeration timeout must no longer terminate it. Users can retry automatic selection or choose an explicit controller from 0 through 15, with a configurable timeout for manual attempts.

If enumeration fails, check that the cable supports data, verify that the Switch is not being charged by the Mac, and reconnect the cable. Do not automatically retry a partially completed text transfer: clear the input and assess the session first to avoid duplicate commands.

USB power direction matters. On the tested hardware, enumeration failed when the Mac was supplying charging power to the Switch. If the Switch is charging from the Mac, unplug and reconnect the cable, then try again. A charging indicator, a loaded kext, or a successful build does not prove USB keyboard enumeration. Successful input appearing inside SmileBASIC is the meaningful confirmation.

During post-bootstrap transmission, the launcher prints each command being sent, including the current host's full `V=START(...)` values for comparison with the console. The GUI also preserves the full command in its activity view and logs. Use the command printed by the current host, especially after changing the Mac's network address.

Important: HID completion is not the same as confirmation of command execution. If the launcher reports that commands were sent, inspect the Switch and the separate ns2jb host window for the actual result. Do not treat an automatic transfer or a Terminal success message as proof of a successful exploit.

This launcher workflow requires the matching updated `mac2jb-commands` binary. Before testing, rebuild it using `make mac2jb-commands` and verify with `./mac2jb-commands --dry-run` that the four commands begin with `LOAD "TXT:NS2"`. A failed build can leave an older three-command executable in place; do not use that executable. These updates are not part of the original v0.1.0 source release.

## Manual workflow

You can still run the tools without the menu. This is useful for debugging or validating a new launcher.

1. Open SmileBASIC → Make a Program with an empty editor and transfer the bootstrap:

   ```sh
   ./mac2jb-send assets/bootstrap.bas --delay-ms 50
   ```

2. Wait until the entire bootstrap has finished typing, inspect it, press X to return to Direct mode, and save it as `NS2` in slot 0. On subsequent runs, skip the lengthy transfer and use the saved program.
3. Start the ns2jb host from the project root in a separate Terminal window:

   ```sh
   bash scripts/host.sh
   ```

4. Once it publishes the current `V=START(...)` command, use the existing command sender:

   ```sh
   ./mac2jb-commands --delay-ms 50
   ```

The manual command sender may ask for confirmations between steps. When using the updated automated sender, verify that the `LOAD` confirmation is handled before `RUN`. Sending HID keystrokes does not prove the upstream ns2jb stages completed.

You can select a known controller manually, for example:

```sh
MAC2JB_CONTROLLER=usb-drd3 ./mac2jb-send assets/bootstrap.bas --delay-ms 50
```

When using the underlying tools, do not assume `MAC2JB_CONTROLLER=auto` is equivalent to leaving it unset; driver and sender versions differ. The verified manual form is `usb-drdN`. The launcher should manage controller selection so ordinary users do not need to set this environment variable.

## Adding HBLauncher apps

1. Keep mac2jb open and click Open session logs. In the Finder window, open
   vendor → HBLauncher → apps. This is the current GUI's app library.
2. Extract a prebuilt HBLauncher GPU app package and copy its whole folder
   there. Its manifest must be directly at `apps/my-app/app.json`, with all
   shader, image and data files kept in their packaged locations:

   ```text
   apps/
     my-app/
       app.json
       app.vert.spv
       app.frag.spv
       app.comp.spv
       assets/
         icon.png
         state.bin
         text.bin
   ```

3. Return to the HBLauncher menu, select Refresh, then select your app and
   press A or tap its row to open it. Return to the menu before updating or
   removing an app folder, then Refresh again.

The library is under `~/Library/Application Support/mac2jb/Sessions/<session-id>/vendor/HBLauncher/apps/`.
Each new mac2jb app launch extracts a fresh library. Keep your downloaded app
packages elsewhere and copy them into the new current library after reopening
mac2jb. Editing a separate source checkout or the session's `source/` copy does
not change the running GUI's library. See [package compatibility, troubleshooting
and custom builds](../docs/HOMEBREW.md#adding-hblauncher-apps).


## Build and check

From the mac2jb repository root:

```sh
bash scripts/check.sh
make clean && make
```

For driver diagnostics:

```sh
kmutil showloaded | grep -i usbgadget
```

The USB driver needs to be loaded for mac2jb to work. After loading it, confirm USB input appears in SmileBASIC.

## Troubleshooting mac2jb

| Symptom | What to check |
| --- | --- |
| `scripts/host.sh: No such file or directory` | The local release extraction is incomplete. Restore the full `scripts/` directory from the repository; don't overwrite it with an empty one. |
| USB doesn't enumerate | Check USB data cable, Mac-to-Switch charging direction, selected controller, driver load state, and Switch input focus. Replug if the Mac charges the Switch. |
| USB helper terminates unexpectedly, or macOS reports a helper crash | Keep the named helper's macOS crash report and use Open session logs. A loaded driver and a user-space helper crash are separate conditions; the crash does not establish that the driver is missing. Repeated installation is not a remedy for a helper crash. |
| `invalid MAC2JB_CONTROLLER 'auto'` | A version mismatch or launcher bug passed a literal `auto` to the driver. Use an explicit `usb-drdN` value or an updated launcher. |
| Unexpected characters (`#` becomes `£`, `A` becomes `Q`, etc.), or a syntax error on bootstrap line 1 | Set the Switch 2's USB Keyboard language to US English under System Settings → Controllers & Accessories. Changing the Mac's layout does not fix it. Clear and resend the corrupted bootstrap after correcting the console setting; other punctuation may also be wrong. No edits to `sender.c` are needed. See [issue #3](https://github.com/cpypwn/mac2jb/issues/3). |
| Pairing file already exists | The launcher should identify and stop only prior ns2jb hosts belonging to this installation before starting a new session, and clear stale pairing files without killing unrelated processes. Do not start a new attempt while an existing ns2jb session is performing work. |
| Pairing parameters not published | Check that `scripts/host.sh` and `scripts/host-wrapper.cjs` exist, Node.js works, and the host is not waiting for network-interface selection. |
| Partially typed code after a disconnect/timeout | Stop and inspect/clear the partial input before retrying; disconnect USB if a key appears stuck. |
| `candidate_pids[@]: unbound variable` | The launcher’s host-process scan encountered an empty array under `set -u`. Use the corrected launcher version; do not interpret this as an ns2jb or USB failure. |
| Display shows four command labels but Switch receives only three | Rebuild `mac2jb-commands` and check its `--dry-run` output. Do not rely on hardcoded launcher labels or an old executable left after a failed build. |
| Host reports an FS acquisition, placement, or native execution failure | This is ns2jb-stage behavior, not proof of a USB typing failure. See upstream ns2jb documentation; the mac2jb maintainer cannot troubleshoot ns2jb internals. |

Unexpected USB helper termination identifies the helper, termination signal
and selected controller in the GUI diagnostics. Preserve those details
and the crash report. After any possible partial typing, inspect and clear the
editor before retrying; if post-bootstrap commands have started, restart the
console before another attempt. Do not automatically replay the transfer.

Run folders can include console memory captures and machine-specific information beyond the pairing command. Review those files before sharing a complete run folder.

## Manual USB driver installation

For manual installation, after configuring macOS to allow the unsigned driver, navigate to the source checkout's `drivers` folder and run:

```sh
# Preserve an installed copy so ditto cannot merge old signature files into it.
if [ -e /Library/Extensions/usbgadget.kext ]; then
  sudo mv /Library/Extensions/usbgadget.kext "/Library/Extensions/.mac2jb-usbgadget-backup-$(uuidgen)"
fi
sudo ditto usbgadget.kext /Library/Extensions/usbgadget.kext
sudo chown -R root:wheel /Library/Extensions/usbgadget.kext
sudo chmod -R go-w /Library/Extensions/usbgadget.kext
sudo sync
sudo kmutil load -p /Library/Extensions/usbgadget.kext
```

Approve any macOS prompt and restart. The USB driver needs to be loaded for mac2jb to work. Compiling is only the fallback below.

If this build is incompatible with your Mac, use the source-build fallback below.

## Building and installing the USB gadget kext (Apple silicon)

This is the fallback for users who cannot use the bundled prebuilt driver. If you already have a compatible build, skip step 1.

1. Install full Xcode, open `vendor/macos_usb_gadget_poc/usbgadget/usbgadget.xcodeproj`, select the `usbgadget` kext target, and build for the Mac. Locate the resulting `usbgadget.kext` in Xcode's build products. Ensure the build architecture and signing configuration are suitable for your Mac. Build completion does not mean the kext is properly signed or approved.
2. Complete the [macOS Recovery setup above](../README.md#1-configure-macos-recovery), unless your existing configuration already loads the driver.
3. Copy the built bundle to the standard third-party location and give the installed copy the ownership and permissions macOS expects. Replace the placeholder path below with the actual build product:

   ```sh
   # Set this to the actual Xcode-built product; do not use a guessed path.
   KEXT="/absolute/path/to/build/Products/Release/usbgadget.kext"
   test -d "$KEXT" || { echo "Kext bundle not found"; exit 1; }

   if [ -e /Library/Extensions/usbgadget.kext ]; then
     sudo mv /Library/Extensions/usbgadget.kext "/Library/Extensions/.mac2jb-usbgadget-backup-$(uuidgen)"
   fi
   sudo ditto "$KEXT" /Library/Extensions/usbgadget.kext
   sudo chown -R root:wheel /Library/Extensions/usbgadget.kext
   sudo chmod -R go-w /Library/Extensions/usbgadget.kext
   ls -ld /Library/Extensions/usbgadget.kext
   ```

   The installed bundle should show `root wheel` ownership, not your user account. Never run these recursive ownership commands against the project directory or other unrelated files.
4. Request installation/validation of the installed copy:

   ```sh
   sudo kmutil load -p /Library/Extensions/usbgadget.kext
   ```

   Follow any macOS approval prompts under System Settings → Privacy & Security, then restart. A signing identity is not required when macOS permits this unsigned driver; kernel-extension policy, approval, ownership, and compatibility still apply.
5. After the required reboot, check:

   ```sh
   kmutil showloaded | grep -i usbgadget
   ```

   A loaded kext does not guarantee HID enumeration. Confirm with the mac2jb USB test or by successfully typing into SmileBASIC.

See [Apple's custom kext installation guide](https://developer.apple.com/documentation/apple-silicon/installing-a-custom-kernel-extension) for approval/reboot details. Installing an experimental kernel driver can reduce system security or stability; avoid changing security settings merely to suppress an unexplained error.

## Source provenance, licensing, and session security

The repository root `LICENSE` applies to mac2jb's MIT-licensed code and does not
relicense third-party material. `vendor/libusbd/LICENSE` and
`vendor/macos_usb_gadget_poc/usbgadget/LICENSE` retain the upstream MIT notices.
Apple-derived headers retain their Apple Public Source License notices; the full
APSL 2.0 text is included in both `vendor/libusbd/LICENSE-APSL-2.0.txt` and
`vendor/macos_usb_gadget_poc/LICENSE-APSL-2.0.txt`. Dated changes to libusbd's
macOS backend and build are recorded inside their respective modified files.
A downstream patch dated 2026-10-26 fixes IOKit service-handle ownership in
`alt_IOUSBDeviceControllerLib.c`; `upstream.lock` still records the upstream
origin, not a claim that the local libusbd tree is unmodified.

`vendor/ns2jb` replaces the previous snapshot with [kurumuz/ns2jb](https://gitlab.com/kurumuz/ns2jb)
at commit `eb2bdec8f3907c5830eb01fb9d55797af7403579`. Its source, runtime,
exploit implementation, and tests are unchanged from that fork. The integrity
manifest `SHA256SUMS` is regenerated to correct 14 stale upstream hashes and
cover added files; the original is preserved in
`packaging/ns2jb-eb2bdec-SHA256SUMS.upstream`.

`assets/bootstrap.bas` is byte-for-byte identical to the fork's
`vendor/ns2jb/bootstrap.bas`, including its comments. Type bootstrap only
transmits this new bootstrap; the wrappers select `NS2_BASIC_ARITY=5` to match its
`START(PORT,A,B,C,D)` interface. Older nine-argument `NS2` programs from v0.3.2
must be replaced before using the saved-bootstrap workflow. Third-party
licenses and notices retain their original terms; see [packaging notices](../packaging/NOTICE.md).
The vendored
`macos_usb_gadget_poc` material is intentionally trimmed to its documented
MIT-licensed `usbgadget/` kernel-extension source/Xcode project. It excludes the
unused `usb_device/` proof of concept and the precompiled `.kext` bundle.
`upstream.lock` identifies the origin and commit, not a guarantee that every
vendored project is an untouched full checkout.

HBLauncher is pinned to [v0.2.0](https://github.com/ravensclawx/HBLauncher/releases/tag/v0.2.0),
commit `b40723be04baa51e5d1f121a1e2242c4167b6cbc`. Its launcher, apps, assets,
and retained notices are bundled with v0.4.3; mac2jb's bridge adapter
connects it to the active held session without the Pico keyboard workflow.

The fork accepts a valid initial console greeting without the previous pairing-token authentication. Use the host on a trusted local network. Its startup cleanup removes every `NS2_GAP`-prefixed root entry on the inspected SmileBASIC `save` and `tmp` mounts; keep personal files under other names.

Session logs: The GUI displays and records complete `V=START(...)` pairing
commands, matching the CLI. Logs and generated run files are excluded from Git
and source ZIPs and use user-only directory/file permissions. The CLI host keeps
its files under `vendor/ns2jb/runs/`; the GUI keeps them in its per-launch
Application Support session folder. To discard old CLI host logs after the host
has stopped, run
`bash scripts/clear-session-logs.sh` (it leaves the current pairing file alone).

The complete source distribution includes the tested unsigned driver in `drivers/usbgadget.kext`, its checksums and provenance, and the source-build fallback. `make` alone does not install the driver.
