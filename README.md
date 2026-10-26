# mac2jb

Use your Apple Silicon Mac to set up [ns2jb](https://gitlab.com/kurumuz/ns2jb) on a Switch 2, then open homebrew tools from the same app. This is experimental:
finishing the keyboard transfer alone does not mean the exploit worked.

## Highly recommended: protect the required software versions

Set up [90DNS](https://consolemods.org/wiki/Switch:Blocking_OFW_Updates#90DNS)
on the Switch 2 before testing. It helps block Nintendo updates that could stop
this setup from working.

1. Open System Settings → Internet → Internet Settings. Select the network
   connection used for testing, choose Change Settings, and set DNS Settings
   to Manual.
2. Enter the IPv4 DNS addresses for your region:
   - North or South America: Primary `207.246.121.77`; Secondary `163.172.141.219`.
   - Anywhere else: Primary `163.172.141.219`; Secondary `207.246.121.77`.
3. Set both primary and secondary IPv6 DNS to `::`, as described in the linked
   guide. Save the settings and reconnect to that network.

90DNS can also block eShop, Nintendo Switch Online and other Nintendo services.
Check the [current guide](https://consolemods.org/wiki/Switch:Blocking_OFW_Updates)
and verify it works on your network. It cannot guarantee protection from updates:
cached addresses, other networks or changed services can bypass it. The `::`
setting may be unsuitable for IPv6-only networks. This protects software versions;
it does not make the exploit safer or more reliable.

## Prerequisites

- An Apple Silicon Mac running macOS 14 or newer.
- A Switch 2 on system software 23.0.1 with SmileBASIC 4.4.9 and more than
  20 MiB free in its save.
- A USB-C cable that supports data, not just charging.
- The Mac and Switch on the same local network. Ethernet is likely required
  for the Switch 2. Wi-Fi has not yet been verified; use Ethernet for now.
- On the Switch, set System Settings → Controllers & Accessories → USB Keyboard
  to US English. The Mac's keyboard layout does not change this requirement.

## Before proceeding: SIP and USB driver requirements

**The bundled USB driver is unsigned. Your Mac's SIP and startup-security configuration must permit unsigned kernel extensions before you can use mac2jb.**

Already have the driver working with a partial/custom SIP setup? Keep that
working setup. Otherwise, follow these steps.

### 1. Configure macOS Recovery

1. Shut down your Mac.
2. Hold the power button until Loading startup options appears.
3. Select Options → Continue. Authenticate with an administrator account if asked.
4. Open Utilities → Startup Security Utility. Select your startup disk and
   click Security Policy.
5. Select Reduced Security.
6. Tick Allow user management of kernel extensions from identified developers.
7. Confirm the changes, authenticate if asked, and close Startup Security Utility.
8. Open Utilities → Terminal and enter:

   ```sh
   csrutil disable
   ```

9. Follow the confirmation and administrator prompts. When it confirms the
   change, choose Apple menu → Restart.
10. Back in macOS, open Terminal and enter:

    ```sh
    csrutil status
    ```

    For this setup, confirm it says `System Integrity Protection status: disabled.`
    An existing working partial/custom setup can report a different status.

<a id="get-mac2jb"></a><a id="install-the-bundled-usb-driver-recommended"></a>

### 2. Install and load the USB driver

1. Download [mac2jb v0.4.3 for Apple Silicon](https://github.com/cpypwn/mac2jb/releases/download/v0.4.3/mac2jb-v0.4.3-macos-arm64.zip), extract the ZIP and open mac2jb.app.
2. If macOS blocks the app, open System Settings → Privacy & Security and choose
   Open Anyway if offered. Open mac2jb again.
3. Click Install & load driver… and approve the administrator prompt.
4. If macOS asks for approval, open System Settings → Privacy & Security and
   click Allow for the driver.
5. Accept the restart prompt or choose Apple menu → Restart.
6. Reopen mac2jb and wait for the driver check. Continue only when the driver
   is loaded and no driver-install restart is pending.

Once installed, refresh its status instead of reinstalling it to check.
Each installation creates a new restart requirement.

Disabling SIP reduces macOS protection. mac2jb does not change it for you.
Fully re-enabling SIP after installing this unsigned driver has not been verified
and may stop it working after a later kernel-collection rebuild. See
[Apple's policy](https://support.apple.com/en-ca/guide/security/sec8e454101b/web)
and [SIP documentation](https://developer.apple.com/documentation/security/disabling-and-enabling-system-integrity-protection).

## Required: replace the old bootstrap

**The old `bootstrap.bas` from previous mac2jb releases using pepsipu's original ns2jb has a nine-argument `START`. It will not work with this version or any future mac2jb release and must be replaced.**

The bootstrap is the small program saved in SmileBASIC as `NS2`. Use the
bundled [kurumuz version](assets/bootstrap.bas), which has five-argument
`START(PORT,A,B,C,D)`. Save it once using these steps:

1. Connect the Mac and Switch with the USB-C data cable.
2. In SmileBASIC, open Make a Program with an empty editor.
3. In mac2jb, select Type bootstrap only, the first option. If using the demo,
   tick I’m using the SmileBASIC demo immediately below it. Leave it off for
   the full game; the app remembers your choice.
4. Start typing and wait until it finishes, usually about 7–10 minutes.
5. Press X to return to Direct mode and save the program with the commands below. mac2jb
   shows a prompt but does not save it for you.
6. After saving, confirm the prompt in mac2jb and return to the start screen.

## SmileBASIC full game versus demo

### Full game

With the bootstrap in slot 0, press X to return to Direct mode and save it with:

```basic
SAVE "NS2"
```

The normal load command is `LOAD "TXT:NS2"`. mac2jb sends it and confirms loading
for you when you start a GUI exploit run.

### SmileBASIC demo

Press X to return to Direct mode, then enter these two save commands in order:

```basic
PRGEDIT 0
SAVEV "TXT:NS2", PRGGET$()
```

With the demo checkbox enabled, mac2jb loads it using this one line:

```basic
PRGEDIT 0:LOADV "TXT:NS2" OUT C$:PRGSET C$
```

Demo loading does not use the full game's extra confirmation Enter. The same
bundled bootstrap works for both editions. Manual demo save/load is confirmed;
automated demo loading still needs a console test. The terminal launcher uses
the full-game route; demo automation uses the GUI checkbox.

## Run the GUI

1. Restart the Switch, open SmileBASIC → Make a Program and enter Direct mode.
2. Select Held RPC in mac2jb. It is the second option and selected by default.
   This keeps the connection open for all the homebrew tools below.
3. In Ready Check, select the Mac's IPv4 address on the network shared with
   the Switch. This picker is for the Mac, not the Switch. Refresh and reselect
   if it changes. USB controller and timing settings are also in Ready Check.
4. Check the SmileBASIC demo checkbox matches your edition, then start the run.
5. Keep SmileBASIC focused and the cable connected. Wait for 4/4 verification
   and confirmation that RPC is open before opening a homebrew tool.

The homebrew list appears directly below Held RPC. The optional tasks are
below that list. The four choices are numbered in this order:

| Choice | Use it for |
| --- | --- |
| Type bootstrap only | Type the program, then save it manually. |
| Held RPC | Run the exploit and keep the connection open for homebrew. |
| System-code dump | Save accessible system-program code, then finish automatically. |
| NS2JB exploit only | Verify the exploit and finish. It cannot launch homebrew. |

Saving `NS2` saves only the program text. Restart the console and run the exploit
again each time; a saved bootstrap does not preserve a live connection.

## Homebrew

Every tool here requires a fresh Held RPC run with 4/4 verification. Use the
Homebrew requires Held RPC section directly below Held RPC. Keep mac2jb and SmileBASIC open,
and choose only one tool per session. No Pico is needed.

- HBLauncher v0.2.0: click Launch HBLauncher to open its GPU app menu.
  For ftpd-sb v0.1.0, select Refresh, open ftpd-sb and press A. It uses FTP port `5000`;
  see the [ftpd-sb guide](docs/FTPD-SB.md).
- OunceCake: enter the Switch's IP in Switch IP address, then click Open game
  list. Choose your game and click Start FTP. Wait for Game files are ready,
  then connect to the Switch's IP on port `2121` using anonymous, passive FTP
  and Binary/Image (TYPE I) transfers. This is a different IP from the Mac's
  address picker. It exports your own games' unencrypted content, not NSP/XCI
  packages or keys. See the [OunceCake guide](docs/OUNCECAKE.md).
- Stremio: install Stremio on the Mac, then click Launch Stremio. The Mac handles
  media playback for the Switch; leave the addon field empty for account addons
  or the bundled 30-second sample. Playback is confirmed; account library and
  watch-sync still need live verification. Torrents and subtitles are unsupported.
  See the [player guide](docs/STREMIO-EXPERIMENTAL.md).

### Add HBLauncher apps

1. In mac2jb, click Open session logs. In Finder, open vendor → HBLauncher → apps.
2. Copy the complete prebuilt app folder there, with its manifest directly at
   `apps/my-app/app.json`. Keep the package's other files together.
3. In HBLauncher, select Refresh, select the app and press A or tap its row.

The current library is at
`~/Library/Application Support/mac2jb/Sessions/<session-id>/vendor/HBLauncher/apps/`.
Reopening mac2jb creates a fresh library. Keep your original app packages elsewhere
and copy them into the new library. See [app compatibility and details](docs/HOMEBREW.md#adding-hblauncher-apps).

## Finish or try again

Disconnect any FTP client, then choose Finish session. Wait for cleanup and
restart the console before another exploit or homebrew attempt. If mac2jb says
cleanup is uncertain, restart the console first, then stop that session.

If typing stops partway through, inspect and clear the partial input before
retrying. After an exploit attempt has started, restart the console before
trying again. Do not send REMOVE twice in the same SmileBASIC session.

<a id="terminal-launcher"></a><a id="usb-selection-and-timeouts"></a><a id="manual-workflow"></a><a id="build-and-check"></a><a id="troubleshooting-mac2jb"></a><a id="manual-usb-driver-installation"></a><a id="building-and-installing-the-usb-gadget-kext-apple-silicon"></a><a id="source-provenance-licensing-and-session-security"></a>

## More help

Use Open session logs if something fails. Keep the error and logs; an unexpected
USB helper crash does not by itself mean the driver is missing.

- [GUI guide](docs/GUI-DEMO.md) and [Homebrew guide](docs/HOMEBREW.md).
- [Terminal commands, builds and detailed troubleshooting](docs/ADVANCED.md).
- [Driver source and checksums](drivers/README.md), [source/licensing details](docs/ADVANCED.md#source-provenance-licensing-and-session-security), and [packaging notices](packaging/NOTICE.md).
- [mac2jb license](LICENSE) and [vendored source information](vendor/README.md).

## Credits

- [pepsipu](https://gitlab.com/pepsipu) — [ns2jb](https://gitlab.com/pepsipu/ns2jb), the original Switch 2 exploit and FS research.
- [kurumuz](https://gitlab.com/kurumuz) — the [ns2jb compatibility fork](https://gitlab.com/kurumuz/ns2jb) bundled in this checkout.
- [ShinyQuagsire](https://github.com/shinyquagsire23) — [libusbd](https://github.com/shinyquagsire23/libusbd) and [macos_usb_gadget_poc](https://github.com/shinyquagsire23/macos_usb_gadget_poc), USB device emulation and experimental macOS gadget-driver work.
- [misshexa66](https://github.com/misshexa66) — [OunceCake](https://github.com/misshexa66/OunceCake), the game-content export tool.
- [RavensClawX](https://github.com/ravensclawx) — [HBLauncher](https://github.com/ravensclawx/HBLauncher), the SmileBASIC GPU app launcher and SDK.

See the project's included licenses and upstream documentation for copyright, attribution, and reuse terms.
