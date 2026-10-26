# mac2jb 0.4.1 packaging

This release replaces the bundled ns2jb runtime with the complete
`kurumuz/ns2jb` snapshot at `eb2bdec8f3907c5830eb01fb9d55797af7403579`.
It includes the changes from v0.3.2 and the subsequent stage-specific recovery
guidance on the main branch. The stable app identity and updater are retained.
See `docs/HOMEBREW.md` for setup and adding compatible apps.

The driver installer records SIP status for diagnostics instead of requiring
an exact fully-disabled summary. macOS enforces filesystem and kernel-extension
load policy; failed load requests retain the actual error and exit status.
Compatible custom configurations are not rejected by the installer. Neither
the installer nor GUI changes SIP, AMFI, or startup security.

The start screen separates bootstrap typing from three saved-NS2 session modes:
exploit only, held RPC, and system-code capture. Each session mode runs a fresh
NS2 workflow. Held RPC and code capture use the separate post-run adapter only
after 4/4 verifies and original FS instructions are restored. Capture uses the
fork's unchanged module against the same live session. Each capture has a new
private output folder. Finishing waits for the fork's own cleanup and a fully
verified final report.

This build also bundles HBLauncher v0.2.0 at
`b40723be04baa51e5d1f121a1e2242c4167b6cbc`, including its apps, SDK, compiled
assets, and retained notices. The separate mac2jb adapter connects the launcher
to an already verified held RPC session; it does not use the Pico keyboard
workflow or replace the five-argument bootstrap. Keep the host and SmileBASIC
open while using it. A stopped GPU launcher is not a guarantee that every
retained allocation was released; restart the console before a fresh session.

The experimental Stremio-compatible player is separate original mac2jb
integration code. It requests the public Stremio addon protocol from Node and
renders a custom GPU frontend; no Stremio Web UI/source is bundled or copied.
It uses the user's installed `/Applications/Stremio.app` media tools for Mac-side
decoding. Those FFmpeg/FFprobe executables are not redistributed by this app.
Direct HTTP(S)/HLS media is the supported source type; torrent sources are not
implemented. Optional account sign-in, addon/library import and watch-progress
sync use Stremio's public API/core record format. The account key stays in the
Mac's Keychain and is not sent to the Node player or console. Account sync is
covered by fixtures and still needs live testing. BC1 video targets 320×180 at
15 fps, with continuous 48 kHz stereo PCM through a new native audio adapter.
The maintainer confirmed Stremio startup and playback in the final test build;
live account synchronization still needs separate confirmation. See
`docs/STREMIO-EXPERIMENTAL.md` for setup, controls and validation limits.

The dump adapter now obtains the acquisition report from the original full FS
proof rather than expecting that field on the fork's short summary. It retains
current-session path and proof checks, capture readback verification, and the
rule against automatically replaying failed or uncertain captures.

The app and complete source distribution include the tested unsigned local
`usbgadget.kext` build, with hashes and provenance in `drivers/README.md`.
Its personal signing certificate has been removed. Source-build instructions
and the vendor source/license remain included.

SocraticBliss contributed feedback and guidance on simplifying driver setup and
documenting the SIP requirement. The USB driver is by Max Thomas / ShinyQuagsire;
its upstream author credits and licenses are retained.

The executable embeds the native mac2jb senders, libusbd, the pinned ns2jb
snapshot, the bootstrap, and an Apple Silicon Node.js runtime. It extracts a
new private session folder under `~/Library/Application Support/mac2jb/Sessions/`
for every launch. Runtime downloads, a separate Node installation, Xcode, and
Command Line Tools are not required to run this prepared app. Those development
tools can still be needed to build and install a compatible USB gadget driver.

Corresponding mac2jb and libusbd source and all retained vendor notices are
embedded under `source/`; the build also produces a separate source archive.
The upstream origin and revisions remain recorded in `source/upstream.lock`.
The root MIT license applies to mac2jb; it does not relicense third-party code.

- libusbd: Max Thomas / ShinyQuagsire; MIT notice preserved, together with
  Apple-derived APSL 2.0 source notices and full license text. Existing dated
  downstream modification notices are retained. This GUI build does not modify
  the libusbd sources or its existing build configuration.
- macos_usb_gadget_poc: the documented, trimmed kernel-extension source and
  license texts remain included. The separately documented local prebuilt is
  under `drivers/`; the old upstream prebuilt is not used.
- ns2jb: original work by pepsipu, with compatibility/recovery changes from
  [kurumuz](https://gitlab.com/kurumuz/ns2jb). The fork's source, runtime, and tests
  are preserved. Its stale/incomplete integrity manifest is regenerated; the
  original is retained in `packaging/ns2jb-eb2bdec-SHA256SUMS.upstream`.
  The transferred bootstrap is byte for byte the fork's five-argument version.
  `scripts/prepare-bootstrap.cjs` copies and verifies that exact asset. The
  wrappers and senders use its five-argument START interface. No new license
  is asserted; retained upstream notices and third-party terms remain applicable.
  GUI orchestration is separate from the vendor source.
- HBLauncher: [RavensClawX](https://github.com/ravensclawx/HBLauncher), v0.2.0
  at `b40723be04baa51e5d1f121a1e2242c4167b6cbc`. Its source, apps, compiled
  assets, SDK, and included notices are retained. The root mac2jb license does
  not relicense this material; the integration adapter is separate.
- ftpd-sb: [RavensClawX](https://github.com/ravensclawx/ftpd-sb), v0.1.0
  at `ab2123cfb97d492264bf6609cb410e285d6d9b5f`. The exact published release
  package is retained under `assets/homebrew-apps/ftpd-sb/`, including source,
  compiled shaders, assets, README, and credits. A runtime overlay adds it to
  HBLauncher's app library without modifying the frozen launcher snapshot or
  its integrity manifest. Release digests and per-file checksums are recorded
  under `packaging/ftpd-sb-v0.1.0-*`. Its README states that no blanket license
  has been assigned; third-party terms remain applicable. The mac2jb root
  license does not relicense this package.
- Node.js: the bundled version's complete upstream LICENSE, including its
  third-party notices, is included as `licenses/node-LICENSE.txt`. The runtime
  version and local-binary hash are recorded in `licenses/node-provenance.json`.
  The app uses the arm64 slice of the locally installed official
  Node distribution, whose linked libraries must all be supplied by macOS.

HBLauncher companion tools are bundled for offline use: Python **3.13.17**
from the standalone **20261021** distribution, Pillow **13.0.0**,
SPIRV-Tools **2026.4**, and DejaVu Sans **2.37**. Their upstream licenses and
third-party notices are retained with the packaged runtime. The mac2jb root MIT
license does not relicense these dependencies.

The GUI never silently changes Reduced Security, SIP, kernel-extension
approval, or firewall policy. The app is ad hoc signed,
not Developer ID signed or notarized.

The smile mark in `gui/KeyboardMark.swift` is original mac2jb artwork used
only for the app icon. The GUI's wordmark is plain text. The app icon does not
export, trace, or modify an Apple SF Symbol. Other system symbols appear as normal
interface elements. Apple's SF Symbols usage restrictions are documented at
https://developer.apple.com/design/human-interface-guidelines/sf-symbols.

The bundled 30-second Big Buck Bunny excerpt is (c) copyright 2008, Blender Foundation / www.bigbuckbunny.org, under CC BY 3.0. It is resized and excerpted for the offline playback test. The source, modifications and exact hashes are recorded in assets/stremio/ATTRIBUTION.md and packaging/stremio-sample-provenance.json.
