# Homebrew in mac2jb

mac2jb v0.4.2 offers **HBLauncher v0.2.0** for GPU apps and **Stremio · experimental**
for Mac-assisted media playback. Choose one application per fresh Held RPC
session. The Mac and SmileBASIC must stay open throughout use.

## Start a fresh Held RPC session

1. Use the current five-argument [kurumuz bootstrap](../assets/bootstrap.bas),
   saved in **slot 0 as NS2**. An old nine-argument saved program must be replaced
   through **Type bootstrap only** or the CLI's **Full install** before proceeding.
   If using the SmileBASIC demo, enable **I’m using the SmileBASIC demo** and use
   the [demo save/load commands](../README.md#smilebasic-full-game-versus-demo).
   Saving the bootstrap does not preserve the exploit or a live RPC session.
2. **Restart the console**, open SmileBASIC in **Direct mode**, and choose
   **Held RPC** in mac2jb. The supported combination is Switch 2 system software
   **23.0.1**, **SmileBASIC 4.4.9**, and more than **20 MiB free** in its save.
   Ethernet is likely required for the Switch 2; Wi-Fi has not yet been verified
   with this setup. Use Ethernet until Wi-Fi support is confirmed.
3. Select the Mac address reachable by the console, start the run, and wait for
   **4/4 verification** and confirmation that RPC is open. Under **Already got
   the ns2jb exploit running?**, choose **Launch HBLauncher** or **Launch Stremio**.

These choices reuse this app's verified live session. No Pico, second bootstrap
or second `REMOVE` is needed. See the [GUI guide](GUI-DEMO.md) for driver setup,
other start-screen actions and system-code capture.

## HBLauncher

Choose **Launch HBLauncher** to open its GPU app menu. The app bundles the
launcher, Hello World, **ftpd-sb v0.1.0**, and its companion tools. HBLauncher
runs GPU app packages through SmileBASIC; it does not load NRO files or install
custom firmware. It is pinned to v0.2.0 commit
`b40723be04baa51e5d1f121a1e2242c4167b6cbc`.

For media playback, choose **Launch Stremio** directly from Held RPC instead.
Install Stremio on the Mac first and follow the
[player guide](STREMIO-EXPERIMENTAL.md). Startup and playback have been confirmed;
account library and watch-progress sync remain experimental and need live
verification.

## Adding HBLauncher apps

Use **Open session logs** in mac2jb to open the current GUI session folder in
Finder, then open **vendor → HBLauncher → apps**. The full location is
`~/Library/Application Support/mac2jb/Sessions/<session-id>/vendor/HBLauncher/apps/`.
The **Open homebrew logs** button opens the launcher's diagnostic run folder;
use **Open session logs** to find the app library.

Extract a compatible prebuilt GPU app package and copy its complete folder into
`apps/`, so the manifest is at `apps/my-app/app.json`. Avoid an extra enclosing
download folder or leaving the app zipped. Keep the manifest's compiled `.spv`
shaders, icon and data files together in their supplied locations. Packages use
the `hblauncher.gpu-app` format and ABI 1; see the
[upstream package guide](../vendor/HBLauncher/README.md#package-manifest).

Return to the HBLauncher menu, choose **Refresh**, select the app and press **A**
or tap its row. To update or remove an app, return to the menu first, replace or
remove its folder, then Refresh. The catalog supports up to **32 apps**. If a
package is missing, check the folder nesting and its required files, then use
**Open homebrew logs** and look at `catalog.rejected` in `app-runtime.json`.

Added packages remain in this GUI session's folder. Closing and reopening
mac2jb creates a new session and a fresh bundled app library; old folders are
retained but are not automatically imported. Keep your original packages and
copy them into the new current library. HBLauncher also starts each GPU app
from its packaged initial memory state on each app launch.

For a custom GUI build, put additional packages in
`assets/homebrew-apps/my-app/` before rebuilding. The build copies these into
the bundled app library. Editing a separate checkout or the session's `source/`
copy alone does not update an already prepared GUI library.

## FTP with ftpd-sb

In HBLauncher, select **Refresh**, open **ftpd-sb**, and press **A** or tap
**Start**. Use the console IP and port displayed by the app, and keep the Mac
host open until transfers finish. See the [FTP connection guide](FTPD-SB.md)
for FileZilla settings and accessible storage.

## Finish or recover

Use **Finish session** in mac2jb when done. Wait for the host's cleanup result,
then restart the console before another exploit or homebrew attempt. Stopping
homebrew does not establish that every retained GPU allocation was released.

After a failed or interrupted native launch, retain the session logs, finish
the session if available, and restart the console. The failed native action is
not automatically retried. Do not issue `REMOVE` again in the same application
process, attach another homebrew app to that session, or reuse its addresses.
