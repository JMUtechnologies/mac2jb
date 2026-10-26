# mac2jb

Uses an Apple Silicon Mac as a USB HID keyboard to type the [ns2jb](https://gitlab.com/kurumuz/ns2jb) SmileBASIC bootstrap into a Nintendo Switch 2 and send its post-bootstrap commands. This is experimental research software; successful USB typing does not guarantee exploit success.

## Highly recommended: protect the required software versions

**I strongly recommend configuring DNS-based blocking of Nintendo update services on the Switch 2 network connection before testing.** The purpose is to reduce the chance of an unwanted system update or SmileBASIC update that could make the tested exploit chain incompatible.

**Recommended service: [90DNS (ConsoleMods guide)](https://consolemods.org/wiki/Switch:Blocking_OFW_Updates#90DNS).** Configure it on the Switch 2 network you use for testing:

1. Open **System Settings → Internet → Internet Settings**, select the network connection used for testing, and choose **Change Settings**. Set **DNS Settings** to **Manual**.
2. Set the **IPv4 DNS** addresses for your region:
   - **North or South America:** Primary `207.246.121.77`; Secondary `163.172.141.219`.
   - **Anywhere else:** Primary `163.172.141.219`; Secondary `207.246.121.77`.
3. **Set both primary and secondary IPv6 DNS to `::`**, as described in the linked guide. Save the settings and reconnect to that network.

90DNS is a third-party DNS service intended to block Nintendo services, not only firmware updates; this may prevent eShop access, Nintendo Switch Online, and other Nintendo features. Check the [current guide](https://consolemods.org/wiki/Switch:Blocking_OFW_Updates) before use and verify the connection and filtering work on your network. **DNS filtering is not a guarantee against updates:** cached addresses, alternative networks, changed endpoints, or other paths can bypass it. The `::` IPv6 setting may also be unsuitable for IPv6-only networks. Do not rely on DNS blocking as the only protection against accidental updates.

This recommendation concerns **preserving the tested firmware/software versions**, not making the exploit safer or more reliable.

## Required: replace the old bootstrap

**The old `bootstrap.bas` from previous mac2jb releases using pepsipu's original ns2jb has a nine-argument `START`. It will not work with this version or any future mac2jb release and must be replaced.**

Replace it with the newly bundled [kurumuz bootstrap](assets/bootstrap.bas), which uses five-argument `START(PORT,A,B,C,D)`, and save it in **slot 0 as `NS2`**. Choose **Type bootstrap only** in the GUI, or **Full install** in the CLI to transmit the new bundled file. Replace any older saved `NS2` before running the exploit.

## Get mac2jb

Download [mac2jb v0.4.0 for Apple Silicon](https://github.com/cpypwn/mac2jb/releases/download/v0.4.0/mac2jb-v0.4.0-macos-arm64.zip),
extract the ZIP, and open **mac2jb.app**. It requires **macOS 14 or newer** and
bundles Node.js, the senders, the host, HBLauncher v0.2.0, ftpd-sb v0.1.0, and
companion tools. The tested unsigned USB driver is included with the app and
complete source distribution; complete the driver setup below before starting.
See the [GUI guide](docs/GUI-DEMO.md).

v0.4.0 uses the kurumuz ns2jb fork and adds a Mac-assisted experimental
Stremio-compatible player. Stremio startup and playback have been confirmed on
the supported console setup; account library and watch-progress sync still need
live verification. Complete the [required bootstrap replacement](#required-replace-the-old-bootstrap),
then follow the [Homebrew guide](docs/HOMEBREW.md) or
[player instructions](docs/STREMIO-EXPERIMENTAL.md).

To build your own GUI, run `make gui` and open `build/mac2jb.app`.

The CLI is also available:
`make` builds the command-line tools, and `bash mac2jb.command` runs the same
terminal workflow.

GUI failures display the diagnostic log's exact path and an **Open logs**
button. Session files stay in private per-launch folders outside the checkout;
build folders and repository-local logs are also ignored by Git.

## Prerequisites and important security notes

- An Apple silicon Mac, Nintendo Switch 2 on **system software 23.0.1**, **SmileBASIC 4.4.9**, and a **data-capable** USB-C connection. The prepared GUI requires **macOS 14 or newer**.
- **Required console keyboard layout:** On the **Switch 2**, open **System Settings → Controllers & Accessories → USB Keyboard** and select **US English** (not UK English or AZERTY). mac2jb sends US-layout USB keycodes regardless of the Mac's keyboard layout. This applies to both bootstrap typing and post-bootstrap commands; you do not need to edit `sender.c` for an AZERTY Mac.
- **CLI/source builds only:** Xcode Command Line Tools for the senders and Node.js **22 or newer** for the host. The prepared GUI bundles its runtime and tools.
- **Driver-build fallback only:** full Xcode if you choose to compile the driver instead of using the included prebuilt copy.
- The pinned vendored sources and `assets/bootstrap.bas`, as included in the complete repository/release archive.
- A reachable local network connection between the Mac and Switch for the ns2jb host stage. **Ethernet is likely required for the Switch 2. Wi-Fi has not yet been verified with this setup; use Ethernet until Wi-Fi support is confirmed.**
- **More than 20 MiB free** in the SmileBASIC save.
- A compatible and **already installed/approved** experimental `usbgadget.kext` for USB gadget mode.

The tested **unsigned** prebuilt driver is at `drivers/usbgadget.kext`. Its source/Xcode project is under:

```text
vendor/macos_usb_gadget_poc/usbgadget/usbgadget.xcodeproj
```

**SIP must be disabled to use the bundled unsigned driver.** You do **not** need to compile or sign it. Enable third-party kernel extensions and complete any macOS approval/reboot prompts as well. The maintainer tested this unsigned driver with SIP disabled. Disabling SIP lowers system protection; mac2jb does not change it automatically. See [Apple's kernel security documentation](https://support.apple.com/guide/security/securely-extending-the-kernel-in-macos-sec8e454101b/web).

`make` builds the **mac2jb command-line utilities**, not the kernel extension. It does not install or approve a kext for you.


### Install the bundled USB driver (recommended)

1. Shut down, hold the power button, and choose **Options → Continue**. In Recovery, enable third-party kernel extensions under **Startup Security Utility → Security Policy → Reduced Security → Allow user management of kernel extensions from identified developers**. Open **Utilities → Terminal**, run `csrutil disable`, and restart. Confirm with `csrutil status` in macOS. Disabling SIP can place startup policy in Permissive Security.
2. **GUI:** open mac2jb and click **Install & load driver…**. Approve the administrator prompt. **CLI:** run `bash mac2jb.command --install-driver`, or choose option 4 from its menu. No Xcode or recompilation is needed for this driver.
3. Approve any request in **System Settings → Privacy & Security**, then restart. Refresh the GUI's checks; the driver must be reported as loaded before starting. From Terminal, verify with `kmutil showloaded --list-only | grep -i usbgadget`.

The installer checks the bundled driver's SHA-256 hashes, installs it at `/Library/Extensions/usbgadget.kext` with `root:wheel` ownership, and requests loading with `kmutil`. An existing driver is moved to a uniquely named backup; its path is printed in activity/logs. The installer never changes SIP or Recovery settings. See [driver provenance and checksums](drivers/README.md).

## Run the GUI

1. Confirm the USB driver is loaded and **restart the console before every run**.
2. To enter or replace `NS2`, choose **Type bootstrap only** and begin with an empty SmileBASIC editor. When typing finishes, save the program as `NS2` in slot 0 and return to the start screen. This choice does not start the host or run the exploit.
3. With the fork's new five-argument `NS2` saved, restart the console, open SmileBASIC in Direct mode, and choose **NS2JB exploit only**, **Held RPC**, or **System-code dump**. Use Ethernet for the Switch 2 until Wi-Fi support is confirmed, and select the Mac's IPv4 address on that network. Each choice loads NS2 and sends RUN, REMOVE, and the current START command.
4. **NS2JB exploit only** verifies the exploit and finishes cleanup. **Held RPC** keeps the verified connection open until **Finish session**. **System-code dump** captures installed system code after verification, then finishes cleanup automatically. Keep the cable connected and SmileBASIC focused. See [the GUI guide](docs/GUI-DEMO.md#choose-a-mode-before-starting) and [session guidance](docs/GUI-DEMO.md).

## Homebrew

Start a fresh **Held RPC** run and wait for 4/4 verification, then choose **Launch HBLauncher** under **Already got the ns2jb exploit running?** to start the bundled **HBLauncher v0.2.0** in the same live mac2jb session. No Pico is needed. Keep mac2jb and SmileBASIC open while using the launcher and its bundled GPU apps. Finish the session and restart the console before another run. See [the Homebrew guide](docs/HOMEBREW.md).

The bundled **ftpd-sb v0.1.0** is ready in HBLauncher: select **Refresh**, open **ftpd-sb**, and press **A** to start FTP. See [the connection guide](docs/FTPD-SB.md).

**Stremio · experimental** is available directly from a verified **Held RPC**
session. Install Stremio on the Mac, then choose **Launch Stremio**; leave the
addon field empty for the bundled 30-second Big Buck Bunny playback sample or enter an addon
manifest URL. The Mac fetches addon data and decodes direct HTTP(S)/HLS media;
the Switch receives a custom GPU menu, BC1 video and continuous PCM audio.
Playback targets 320×180 at 15 fps, and startup and playback have been confirmed
on the supported setup. Optional Mac sign-in imports account addons and library,
resumes saved movies/episodes, and syncs playback progress; live account library
and watch-sync behavior have not yet been independently verified. Torrent sources
and subtitles are unsupported. Choose one homebrew app per fresh Held RPC session. See the
[player guide and controls](docs/STREMIO-EXPERIMENTAL.md).

### Add HBLauncher apps

1. Keep mac2jb open and click **Open session logs**. In the Finder window, open
   **vendor → HBLauncher → apps**. This is the current GUI's app library.
2. Extract a prebuilt **HBLauncher GPU app** package and copy its whole folder
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

3. Return to the HBLauncher menu, select **Refresh**, then select your app and
   press **A** or tap its row to open it. Return to the menu before updating or
   removing an app folder, then Refresh again.

The library is under `~/Library/Application Support/mac2jb/Sessions/<session-id>/vendor/HBLauncher/apps/`.
Each new mac2jb app launch extracts a fresh library. Keep your downloaded app
packages elsewhere and copy them into the new current library after reopening
mac2jb. Editing a separate source checkout or the session's `source/` copy does
not change the running GUI's library. See [package compatibility, troubleshooting
and custom builds](docs/HOMEBREW.md#adding-hblauncher-apps).

## Terminal launcher

The terminal launcher provides the full bootstrap workflow and a shortcut for retrying an existing saved bootstrap. From the repository root:

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

Option 1 — Full install: Open **SmileBASIC → Make a Program** with an empty editor. Wait until the entire bootstrap has finished typing, then inspect the program, save it as `NS2` in **slot 0**, and enter **Direct mode** before pressing Enter. The launcher then starts the ns2jb host in a separate Terminal window and waits for the current session’s pairing command before transmitting post-bootstrap commands.

Bootstrap transfer time: The bundled bootstrap is 8,084 characters over 229 lines. At the default `--delay-ms 50`, typing typically takes about 7–10 minutes, including USB overhead and indentation adjustments. This is an estimate, not a hard timeout. After enumeration succeeds, leave the Terminal window open and the cable connected until typing completes.

Option 2 — Post-bootstrap only: With the fork's new five-argument bootstrap saved as `NS2` in **slot 0**, **restart the console → open SmileBASIC → enter Direct mode**. The launcher skips the bootstrap transfer, starts a new ns2jb host session, and automatically sends `LOAD "TXT:NS2"` followed by the remaining post-bootstrap commands.

Option 4 — Install & load bundled USB driver: Installs the included unsigned `usbgadget.kext`, preserves any existing driver in a backup, and requests loading. Disable SIP and enable kernel extensions in Recovery first; complete any macOS approval prompts and restart before choosing option 1 or 2. You can also run `bash mac2jb.command --install-driver` directly.

The launcher opens the ns2jb host in another Terminal window and waits for its current session’s `V=START(...)` pairing command before submitting the post-bootstrap commands. They are sent in this order:

```basic
LOAD "TXT:NS2"
RUN
REMOVE NSR,&H60000000,&H3FFFFFFF
V=START(...)
```

After the `LOAD` command, SmileBASIC asks the user to confirm loading `NS2`. The updated command sender transmits an additional Enter to accept the highlighted YES option before sending `RUN`. The `Out of memory` response to `REMOVE` is expected. The `V=START(...)` command is printed by the active ns2jb host; the example above is a placeholder.

### USB selection and timeouts

The launcher attempts the tested controllers (`usb-drd0`, `usb-drd1`, `usb-drd3`) and identifies each attempt in the terminal. The intended automatic enumeration timeout is **4 seconds per controller**; once HID transfer starts, the enumeration timeout must no longer terminate it. Users can retry automatic selection or choose an explicit controller from **0 through 15**, with a configurable timeout for manual attempts.

If enumeration fails, check that the cable supports data, verify that the Switch is not being charged by the Mac, and reconnect the cable. **Do not automatically retry a partially completed text transfer:** clear the input and assess the session first to avoid duplicate commands.

**USB power direction matters.** On the tested hardware, enumeration failed when the Mac was supplying charging power to the Switch. If the Switch is charging from the Mac, unplug and reconnect the cable, then try again. A charging indicator, a loaded kext, or a successful build does not prove USB keyboard enumeration. Successful input appearing inside SmileBASIC is the meaningful confirmation.

During post-bootstrap transmission, the launcher prints each command being sent, including the current host's full `V=START(...)` values for comparison with the console. The GUI also preserves the full command in its activity view and logs. Use the command printed by the current host, especially after changing the Mac's network address.

**Important:** HID completion is not the same as confirmation of command execution. If the launcher reports that commands were sent, inspect the Switch and the separate ns2jb host window for the actual result. Do not treat an automatic transfer or a Terminal success message as proof of a successful exploit.

This launcher workflow requires the matching updated `mac2jb-commands` binary. Before testing, rebuild it using `make mac2jb-commands` and verify with `./mac2jb-commands --dry-run` that the four commands begin with `LOAD "TXT:NS2"`. A failed build can leave an older three-command executable in place; do not use that executable. These updates are not part of the original v0.1.0 source release.

## Manual workflow

You can still run the tools without the menu. This is useful for debugging or validating a new launcher.

1. Open **SmileBASIC → Make a Program** with an **empty** editor and transfer the bootstrap:

   ```sh
   ./mac2jb-send assets/bootstrap.bas --delay-ms 50
   ```

2. Wait until the entire bootstrap has finished typing, inspect and save it as `NS2` in **slot 0**, then enter **Direct mode**. On subsequent runs, skip the lengthy transfer and use the saved program.
3. Start the ns2jb host from the project root in a separate Terminal window:

   ```sh
   bash scripts/host.sh
   ```

4. Once it publishes the **current** `V=START(...)` command, use the existing command sender:

   ```sh
   ./mac2jb-commands --delay-ms 50
   ```

The manual command sender may ask for confirmations between steps. When using the updated automated sender, verify that the `LOAD` confirmation is handled before `RUN`. Sending HID keystrokes does not prove the upstream ns2jb stages completed.

You can select a known controller manually, for example:

```sh
MAC2JB_CONTROLLER=usb-drd3 ./mac2jb-send assets/bootstrap.bas --delay-ms 50
```

When using the underlying tools, **do not assume `MAC2JB_CONTROLLER=auto` is equivalent to leaving it unset**; driver and sender versions differ. The verified manual form is `usb-drdN`. The launcher should manage controller selection so ordinary users do not need to set this environment variable.

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
| `invalid MAC2JB_CONTROLLER 'auto'` | A version mismatch or launcher bug passed a literal `auto` to the driver. Use an explicit `usb-drdN` value or an updated launcher. |
| Unexpected characters (`#` becomes `£`, `A` becomes `Q`, etc.), or a syntax error on bootstrap line 1 | Set the **Switch 2's USB Keyboard language to US English** under **System Settings → Controllers & Accessories**. Changing the Mac's layout does not fix it. Clear and resend the corrupted bootstrap after correcting the console setting; other punctuation may also be wrong. No edits to `sender.c` are needed. See [issue #3](https://github.com/cpypwn/mac2jb/issues/3). |
| Pairing file already exists | The launcher should identify and stop only prior ns2jb hosts belonging to this installation before starting a new session, and clear stale pairing files without killing unrelated processes. Do not start a new attempt while an existing ns2jb session is performing work. |
| Pairing parameters not published | Check that `scripts/host.sh` and `scripts/host-wrapper.cjs` exist, Node.js works, and the host is not waiting for network-interface selection. |
| Partially typed code after a disconnect/timeout | Stop and inspect/clear the partial input before retrying; disconnect USB if a key appears stuck. |
| `candidate_pids[@]: unbound variable` | The launcher’s host-process scan encountered an empty array under `set -u`. Use the corrected launcher version; do not interpret this as an ns2jb or USB failure. |
| Display shows four command labels but Switch receives only three | Rebuild `mac2jb-commands` and check its `--dry-run` output. Do not rely on hardcoded launcher labels or an old executable left after a failed build. |
| Host reports an FS acquisition, placement, or native execution failure | This is **ns2jb-stage behavior**, not proof of a USB typing failure. See upstream ns2jb documentation; the mac2jb maintainer cannot troubleshoot ns2jb internals. |

Run folders can include console memory captures and machine-specific information beyond the pairing command. Review those files before sharing a complete run folder.

## SmileBASIC full game versus demo

The full game can save the bootstrap for later sessions. Historically, the demo was treated as unable to save it, so demo users were instructed to retransmit it each session.

### Unverified demo save/load workaround

A community-reported workaround uses the following commands as a possible way to persist a program in the demo:

**Save program:**

```basic
PRGEDIT 0
SAVEV "TXT:MYPROG", PRGGET$()
```

**Load program:**

```basic
PRGEDIT 0:LOADV "TXT:MYPROG" OUT C$:PRGSET C$
```

Replace `MYPROG` with your chosen name. For the ns2jb bootstrap, confirm that the correct code is present in slot 0 after loading, and run an integrity check if available.

## Manual USB driver installation

For manual installation, after disabling SIP and enabling kernel extensions, navigate to the source checkout's `drivers` folder and run:

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

Approve any macOS prompt and restart. The USB driver needs to be loaded for mac2jb to work. This prebuilt-driver setup follows **SocraticBliss's** recommendation; compiling is only the fallback below.

If this build is incompatible with your Mac, use the source-build fallback below.

## Building and installing the USB gadget kext (Apple silicon)

This is the fallback for users who cannot use the bundled prebuilt driver. If you already have a compatible build, skip step 1.

1. Install **full Xcode**, open `vendor/macos_usb_gadget_poc/usbgadget/usbgadget.xcodeproj`, select the `usbgadget` kext target, and build for the Mac. Locate the resulting `usbgadget.kext` in Xcode's build products. Ensure the build architecture and signing configuration are suitable for your Mac. Build completion does **not** mean the kext is properly signed or approved.
2. Shut down the Mac, then hold the power button until startup options appear. Choose **Options → Continue** to enter macOS Recovery. Enable third-party kernel extensions in **Startup Security Utility → Security Policy**, using **Reduced Security → Allow user management of kernel extensions from identified developers**. In Recovery, open **Utilities → Terminal**, run `csrutil disable`, and follow its prompts. Restart into macOS and run `csrutil status` to confirm SIP is disabled. Disabling SIP can place the startup policy in Permissive Security; Reduced Security alone is not sufficient for unsigned kext loading.
3. Copy the **built** bundle to the standard third-party location and give the installed copy the ownership and permissions macOS expects. Replace the placeholder path below with the actual build product:

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

   The installed bundle should show **`root wheel`** ownership, not your user account. Never run these recursive ownership commands against the project directory or other unrelated files.
4. Request installation/validation of the **installed** copy:

   ```sh
   sudo kmutil load -p /Library/Extensions/usbgadget.kext
   ```

   Follow any macOS approval prompts under **System Settings → Privacy & Security**, then restart. A signing identity is not required for the unsigned-driver setup with SIP disabled; kernel-extension policy, approval, ownership, and compatibility still apply.
5. After the required reboot, check:

   ```sh
   kmutil showloaded | grep -i usbgadget
   ```

   A loaded kext does not guarantee HID enumeration. Confirm with the mac2jb USB test or by successfully typing into SmileBASIC.

See [Apple's custom kext installation guide](https://developer.apple.com/documentation/apple-silicon/installing-a-custom-kernel-extension) for approval/reboot details. Installing an experimental kernel driver can reduce system security or stability; avoid changing security settings merely to suppress an unexplained error.

## Source provenance, licensing, and session security

The repository root `LICENSE` applies to mac2jb's MIT-licensed code and does **not**
relicense third-party material. `vendor/libusbd/LICENSE` and
`vendor/macos_usb_gadget_poc/usbgadget/LICENSE` retain the upstream MIT notices.
Apple-derived headers retain their Apple Public Source License notices; the full
APSL 2.0 text is included in both `vendor/libusbd/LICENSE-APSL-2.0.txt` and
`vendor/macos_usb_gadget_poc/LICENSE-APSL-2.0.txt`. Dated changes to libusbd's
macOS backend and build are recorded inside their respective modified files.

`vendor/ns2jb` replaces the previous snapshot with [kurumuz/ns2jb](https://gitlab.com/kurumuz/ns2jb)
at commit `eb2bdec8f3907c5830eb01fb9d55797af7403579`. Its source, runtime,
exploit implementation, and tests are unchanged from that fork. The integrity
manifest `SHA256SUMS` is regenerated to correct 14 stale upstream hashes and
cover added files; the original is preserved in
`packaging/ns2jb-eb2bdec-SHA256SUMS.upstream`.

`assets/bootstrap.bas` is byte-for-byte identical to the fork's
`vendor/ns2jb/bootstrap.bas`, including its comments. **Type bootstrap only**
transmits this new bootstrap; the wrappers select `NS2_BASIC_ARITY=5` to match its
`START(PORT,A,B,C,D)` interface. Older nine-argument `NS2` programs from v0.3.2
must be replaced before using the saved-bootstrap workflow. Third-party
licenses and notices retain their original terms; see [packaging notices](packaging/NOTICE.md).
The vendored
`macos_usb_gadget_poc` material is intentionally **trimmed** to its documented
MIT-licensed `usbgadget/` kernel-extension source/Xcode project. It excludes the
unused `usb_device/` proof of concept and the precompiled `.kext` bundle.
`upstream.lock` identifies the origin and commit, not a guarantee that every
vendored project is an untouched full checkout.

HBLauncher is pinned to [v0.2.0](https://github.com/ravensclawx/HBLauncher/releases/tag/v0.2.0),
commit `b40723be04baa51e5d1f121a1e2242c4167b6cbc`. Its launcher, apps, assets,
and retained notices are bundled with v0.4.0; mac2jb's bridge adapter
connects it to the active held session without the Pico keyboard workflow.

The fork accepts a valid initial console greeting without the previous pairing-token authentication. Use the host on a trusted local network. Its startup cleanup removes every `NS2_GAP`-prefixed root entry on the inspected SmileBASIC `save` and `tmp` mounts; keep personal files under other names.

**Session logs:** The GUI displays and records complete `V=START(...)` pairing
commands, matching the CLI. Logs and generated run files are excluded from Git
and source ZIPs and use user-only directory/file permissions. The CLI host keeps
its files under `vendor/ns2jb/runs/`; the GUI keeps them in its per-launch
Application Support session folder. To discard old CLI host logs after the host
has stopped, run
`bash scripts/clear-session-logs.sh` (it leaves the current pairing file alone).

The complete source distribution includes the tested unsigned driver in `drivers/usbgadget.kext`, its checksums and provenance, and the source-build fallback. `make` alone does not install the driver.

## Credits

- **[RavensClawX](https://github.com/ravensclawx)** — [HBLauncher](https://github.com/ravensclawx/HBLauncher), the SmileBASIC GPU app launcher and SDK.
- **[kurumuz](https://gitlab.com/kurumuz)** — the [ns2jb compatibility fork](https://gitlab.com/kurumuz/ns2jb) bundled in this checkout.
- **[pepsipu](https://gitlab.com/pepsipu)** — [ns2jb](https://gitlab.com/pepsipu/ns2jb), the original Switch 2 exploit and FS research.
- **[ShinyQuagsire](https://github.com/shinyquagsire23)** — [libusbd](https://github.com/shinyquagsire23/libusbd) and [macos_usb_gadget_poc](https://github.com/shinyquagsire23/macos_usb_gadget_poc), USB device emulation and experimental macOS gadget-driver work.
- **[SocraticBliss](https://github.com/SocraticBliss)** — feedback and guidance that helped simplify USB driver installation, clarify the SIP requirement, and provide a prebuilt-driver setup path.

See the project's included licenses and upstream documentation for copyright, attribution, and reuse terms.
