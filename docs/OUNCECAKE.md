# OunceCake game-content export

mac2jb includes [OunceCake](https://github.com/misshexa66/OunceCake) by
misshexa66. It exposes unencrypted romFS/exeFS content from a selected game,
including available updates and DLC, through read-only FTP. Use it only with
your own games on your own console. The console opens the content normally;
OunceCake does not supply system keys or decrypt files on the Mac.

## Start and choose a game

1. Use the current five-argument bootstrap saved as NS2 in slot 0. Follow
   the [Homebrew setup](HOMEBREW.md#start-a-fresh-held-rpc-session), including
   the demo checkbox if applicable.
2. Restart the console, open SmileBASIC → Make a Program and enter Direct
   mode. Start Held RPC in mac2jb. Wait for 4/4 verification and confirmation that RPC is open.
3. Under Homebrew requires Held RPC, find OunceCake. Enter the
   console’s local address in Switch IP address and click Open game list.
4. Under Choose a game, select the game you want to export, then click
   Start FTP.
5. Wait until mac2jb reports Game files are ready. Preparing installed updates
   can take a long time; do not start another launch while it is working.
6. Connect an FTP client such as FileZilla using the settings below and
   download the wanted folders to your Mac. Use the Switch 2's IP from its
   network settings, not the Mac's IP. Keep mac2jb, SmileBASIC and both devices
   awake while transferring.
7. When transfers finish, disconnect the FTP client and choose Finish session
   in mac2jb. Wait for cleanup, then restart the console before another attempt.

OunceCake attaches directly to this app's current Held RPC session. It does not
run inside HBLauncher and needs no Pico, second bootstrap or second REMOVE.
Choose one application per fresh session. After using or attempting HBLauncher,
Stremio or OunceCake, finish and restart before choosing another.

## FTP settings

| Setting | Value |
| --- | --- |
| Protocol | FTP |
| Host | The Switch 2's local IP address |
| Port | `2121` |
| Encryption | Only use plain FTP |
| Logon | Anonymous; no account or password is required |
| Transfer mode | Passive |
| Transfer type | Binary / Image / TYPE I |

Binary mode is required for file downloads. Keep the connection on a trusted
local network: this server has no login protection or encryption. OunceCake's
port `2121` is separate from [ftpd-sb](FTPD-SB.md), which runs in HBLauncher and
normally uses port `5000` for SmileBASIC storage.

## What is exported

Available content appears under these paths:

- `/base/romfs` and `/base/exefs` for the selected game's base content.
- `/updates/<version>/romfs` and `/updates/<version>/exefs` for updates.
- `/dlc/<title-id>/<version>/romfs` for DLC.

The available folders depend on the selected game, installed content and local
access rights. Upstream supports digital titles, game cards and Switch 2
Editions; this mac2jb integration still needs a live console test. The output
is extracted game content, not an installable NSP/XCI package, a full NAND
backup or system keys. FTP is read-only and cannot upload or delete game files.

If preparation or a transfer fails, keep the session logs and any partial
downloads. The native launch is not automatically replayed. Finish the session
if available and restart the console before another launch. If mac2jb reports
uncertain native cleanup, follow its prompt: restart the console first, then
stop this session. An interrupted file download is not proof of a complete
export.

## Source and license

OunceCake is pinned to commit
`e3bcbd229be2229d44f036455adddda921ade3b2` of
[misshexa66/OunceCake](https://github.com/misshexa66/OunceCake/tree/e3bcbd229be2229d44f036455adddda921ade3b2).
Its source, native FTP image, build script, README and GPLv2 license are retained
with the distribution, including upstream's Atmosphere attribution. Dated
host-side patches verify native FTP startup/shutdown and bound program-map
traversal; the bundled native image is unchanged. mac2jb's MIT license does not
relicense OunceCake.
