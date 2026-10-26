# Experimental Stremio-compatible player

mac2jb v0.4.2 includes an experimental Mac-assisted player for its verified
Held RPC session. The Mac requests real Stremio addon catalogs, metadata, episodes
and streams, then decodes supported media. The Switch displays the menu and
video through a GPU app and plays PCM audio through a new native audio adapter.
Startup and playback have been confirmed on the supported console setup. Keep
both the Mac and SmileBASIC open throughout playback.

The Node protocol client and menu are original integration code. This build
does not copy Stremio Web or run its browser interface on the console. The
[Stremio addon protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)
defines the catalog, metadata and stream requests it uses.

## Try it

1. Install **Stremio on the Mac** at `/Applications/Stremio.app`. The player
   uses that app's `ffmpeg` and `ffprobe` executables; these executables are not
   redistributed inside mac2jb. mac2jb does not install or update Stremio.
2. Use the fork's current five-argument bootstrap, saved in **slot 0 as NS2**.
   For a demo-capable GUI build, select **I’m using the SmileBASIC demo** if
   applicable and follow the [demo save/load instructions](../README.md#smilebasic-full-game-versus-demo).
   Restart the console, open SmileBASIC in Direct mode, choose **Held RPC** in
   mac2jb and start a fresh exploit session.
3. Wait for **4/4 verification** and confirmation that RPC is open. Under
   **Already got the ns2jb exploit running?**, enter a supported addon's HTTP(S)
   `manifest.json` URL, or sign in on the Mac to import your account addons and
   library. A manually entered URL overrides the account addon list. With the
   field empty and no account addons available, the player uses the bundled
   30-second Big Buck Bunny playback sample.
4. Choose **Launch Stremio**. The player uses this app's current verified held
   session. It does not retype the bootstrap or resend LOAD, RUN or REMOVE.
   Select a title, an episode when applicable, and a direct HTTP(S)/HLS source.
5. Use **Finish session** in mac2jb when finished. Wait for cleanup and restart
   the console before another exploit session. Closing mac2jb cancels in-flight
   account requests.

Only one homebrew application can be launched per exploit session. Choose
Stremio directly from Held RPC; do not launch HBLauncher first and then try to
attach this player. It cannot attach to an arbitrary external RPC session.

## Controls

| Screen | Controls |
| --- | --- |
| Catalog, details, episodes or sources | D-pad up/down selects; **A** opens; **B** goes back |
| Browsing | **X** refreshes the current list; **Y** moves to the next catalog |
| Playback | **A** pauses/resumes; left/right seeks backward/forward 10 seconds |
| Playback | Up/down changes volume by 5 percentage points; **B** stops and returns to sources |

The menu shows at most eight rows at once and scrolls the selected item into
view. Unsupported source types and addon/network errors are shown explicitly.
The Mac activity view and **Open homebrew logs** provide further diagnostics.

## Account library and resume

**Live account sign-in, library/resume and watch-progress sync have not yet been
independently verified.** They are included as experimental account features;
confirmed playback does not establish that cloud updates were saved.

Optional sign-in opens Stremio's account-link page in the Mac browser. The
account key stays on the Mac in Keychain; it is not sent to the Switch or the
Node player. The player receives imported addon URLs and a library snapshot.
Addon URLs may contain private provider configuration, so keep local session
files private. The player accepts up to 32 compatible account addons and a
browsing snapshot of up to 500 library records; the Mac reports import limits.

**Continue watching** and **My Library** appear before addon catalogs when
library records are available. Open a saved item and choose **Resume** to use
its recorded movie or episode and position. Selecting a different episode
starts that episode at the beginning. Source lookup still requires an imported
addon that supports the item's ID and returns supported media.

While signed in, the Mac saves playback progress about every 30 seconds and
when pausing, seeking, stopping, finishing or completing playback. It fetches
the current cloud record before merging progress, retains unrelated library
fields, and tracks actual watched time separately from seek distance. Account
or network failures are shown on the Mac; they do not prove that progress was
saved. Refresh the account before launching a new player session to fetch
changes made on other devices.

The merge follows Stremio's public
[library record](https://github.com/Stremio/stremio-core/blob/development/src/types/library/library_item.rs)
and [player state](https://github.com/Stremio/stremio-core/blob/development/src/models/player.rs)
formats, including millisecond cloud offsets and per-episode watched state.

## Current limits

- Playback targets **320×180 at 15 fps**. Frames use BC1 compression for transfer
  to the GPU; audio uses continuous 48 kHz stereo signed 16-bit PCM. Startup and
  playback are confirmed, but throughput, frame timing and audio synchronization
  need broader testing. These settings are targets, not a measured performance
  guarantee for every source or network.
- Only direct **HTTP(S) media URLs and HLS** are supported. Torrent/info-hash,
  YouTube-ID and external-browser sources are reported as unsupported. Some
  providers return only these source types.
- Subtitle selection and torrent streaming are not included. Imported account
  addons can return unsupported sources even when their catalogs work.
- Library and watch-progress sync follow Stremio's public core record format.
  Fixture tests cover parsing and merges; live cloud sync still needs testing
  with an account, and simultaneous playback on other devices can race updates.
- Native graphics and continuous-audio adapters are new. The confirmed playback
  result does not establish reliable cleanup or timing on every supported setup.
  Restart the console after a failed or interrupted native operation.

If a media/network/decoder error returns to the source list, another supported
source can be selected within the player. If the app reports an uncertain
native request, a graphics/audio error, a lost RPC connection or incomplete
cleanup, keep the logs, finish the session and restart the console. Do not
replay the failed native action or start a second homebrew app in that session.

## Verification and reports

Offline fixture tests cover actual HTTP addon requests, resource and ID-prefix
rules, episode/source selection, controller actions, URL/header redaction,
timeouts and response-size limits. A real Pillow renderer produces a complete
320×180 RGBA menu. Library fixtures check millisecond conversion, exact episode
resume IDs, counter bounds and preservation of unrelated state. Media tests
decode a generated HTTP video and its audio with
the installed Stremio tools, and check the BC1 frame format. Native protocol and
audio tests also use controlled adapters. Console startup and playback have now
been confirmed; account cloud behavior, broader media compatibility, timing and
failure recovery still need reports from real use.

For a hardware report, record the catalog/source type, wired network setup,
whether picture and sound both appeared, pause/seek behavior, audible dropouts
or timing drift, and the final cleanup result. Preserve the session directory.
Review logs before sharing addon configuration or media URLs that contain
private provider tokens.
