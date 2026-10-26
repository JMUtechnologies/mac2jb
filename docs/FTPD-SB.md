# ftpd-sb v0.1.0

mac2jb v0.4.3 includes the exact published ftpd-sb v0.1.0 package.
It runs inside the bundled HBLauncher v0.2.0; no Pico or app compilation is
needed for this mac2jb workflow.

1. Start a fresh Held RPC run and wait for 4/4 verification, then choose
   Launch HBLauncher in the same live mac2jb session.
2. In HBLauncher, select Refresh, open ftpd-sb, and press A or tap
   Start. Use the console IP address and port shown on screen.
3. Connect from FileZilla with the settings below. Keep mac2jb and SmileBASIC
   open until transfers finish. B / Minus / Back returns to HBLauncher and
   closes FTP connections.

| FileZilla setting | Value |
| --- | --- |
| Protocol | FTP |
| Host | The console IP displayed by ftpd-sb |
| Port | `5000`, or the displayed port |
| Encryption | Only use plain FTP |
| Logon type | Anonymous |
| Transfer mode | Passive |
| Maximum simultaneous connections | 1 |

`/save` and `/tmp` are writable SmileBASIC storage; `/rom` is read-only.
This does not expose the SD card or other games' saves. Writes change actual
SmileBASIC data, and interrupted uploads can leave partial files. Use plain
anonymous FTP on a trusted LAN and finish transfers before stopping the app.

The package is pinned to release tag v0.1.0, source commit
`ab2123cfb97d492264bf6609cb410e285d6d9b5f`. Its original source, shaders,
prebuilt assets, README, and notices are retained in
`assets/homebrew-apps/ftpd-sb/`. Packaging copies that overlay into the runtime's
`vendor/HBLauncher/apps/ftpd-sb/` after copying the frozen launcher, leaving
the original HBLauncher source and integrity manifest unchanged.

The release ZIP's SHA-256 is
`e3c0e0387d2cdaa6b9345cd8e601cab584f7e46c5f16a285a39c368b5d33140e`;
it matches both GitHub's asset digest and the published SHA256SUMS. Per-file
hashes and release provenance are retained under `packaging/`.

See the [upstream release](https://github.com/ravensclawx/ftpd-sb/releases/tag/v0.1.0)
and the included [original README](../assets/homebrew-apps/ftpd-sb/README.md)
for the full controls, supported operations, and limitations. Upstream states
that no blanket license has been assigned to the package; third-party terms
remain in effect, and mac2jb does not relicense it.
