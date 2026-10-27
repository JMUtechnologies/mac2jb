# Capability matrix

Evidence concerns the investigated SmileBASIC 4.4.9 / Switch 2 23.0.1 environment. An SDK symbol proves that code exists, not that permissions, initialization, hardware or a working application feature are available. The inventory distinguishes imports from definitions and does not call discovered functions indiscriminately. Historical console tests below are not new validation of the current platform release.

## Implemented or directly investigated features

| Capability | SDK access | Evidence and limits |
|---|---|---|
| GPU graphics | GLSL/SPIR-V vertex/fragment pipelines, storage buffers, fullscreen rendering | Launcher ran on console. Compatible GLSL/HLSL executed on local Vulkan; HLSL was not tested on physical Switch |
| GPU computation | Per-frame logic and optional multipass app sequences | Implemented in the runtime/examples; limited by application ABI |
| Buttons/sticks | Main-controller helpers and five standard styles | Input checked in handheld mode; other physical controllers need separate qualification |
| Touch | Up to 16 records with coordinates, IDs and attributes | Native per-frame reads and launcher interactions checked |
| Accelerometer | Up to two native motion records | Changing sample numbers observed; stationary acceleration approximately 1 g |
| Gyroscope/orientation | Angular velocity, angle and direction matrix | Native records received; zero stationary velocity; moving scale/orientation not calibrated |
| Keyboard | 256-bit key map and modifiers | Native reads succeeded; external keyboard events not physically tested |
| Mouse | Position, relative movement, wheel, buttons and attributes | Native reads succeeded; external mouse events not physically tested |
| Joy-Con 2 optical mouse | Jcms service, per-frame ring snapshot, signed movement | Both axes and built-in cursor checked on console; independent of normal mouse input |
| Controller colors/LED | HID diagnostics and inventoried LED functions | Colors read on console; no application LED-control API |
| Vibration | Independent low/high frequency envelopes, intervals, stop | Physical vibration confirmed; streaming readback showed nonzero amplitudes/frequencies. PCM/HD Rumble 2 encoding not implemented |
| Network/IPv4 | Telemetry and host API | Console IPv4 queried during a live session |
| UDP | Console exchange and shader mailbox | Exact 32-byte random echo confirmed on console/host |
| NFC | Enumerate readers, start/stop detection, tag-information interface | One handheld reader found and discovery accepted; no tag read yet |
| Amiibo/NFP | Interface availability only | nfp:user opens; amiibo connection/read/write not implemented |
| IR camera | Descriptor and state query | Handheld descriptor reported state 1 (unsupported); image capture unconfirmed |
| Audio output | Owned PCM playback path | Console playback/resource lifecycle implemented |
| Audio input | Device-name enumeration | audin:u opens; ListAudioIns returned BuiltInHeadset; recording not tested |
| TCP/FTP | Console server, passive transfer, background service | TCP echo and FTP write/read cycle checked; one client; see [FTP](ftp.md) |
| DNS/TLS | Inventory only | TLS symbols and ssl service found; no DNS/TLS-handshake adapter/test |
| Local wireless/Bluetooth | Inventory only | ldn/bluetooth/btm exports found; no pairing API |
| HID accessory bus | Interface probe only | hidbus returned raw Result 0x1015; does not establish Ring-Con/accessory support |
| Storage | Title-owned files and host module resources | save:/ and tmp:/ read/write/commit checked historically; rom:/ read only; SD access rejected |
| Time/threads/memory | Internal native worker support | Timers, pthread and owned buffers implemented; not a general CPU-app environment |
| Applets/accounts/web/album | Inventory only | Functions/imports do not establish an application API |
| JIT/runtime modules | Inventory and service probes | 11 nn::jit functions and nn::ro::LoadModule found. jit:u denied with 0x1015 (NotAllowed); ldr:ro opens, but custom CPU-code loading unconfirmed |
| Cartridge | GameCard symbols and dedicated FS service probes | fsp-srv, initialization and OpenDeviceOperator succeeded; presence request returned transport error 0x25a0b for both ordinary CMIF and Hipc2. Presence/data access remain unconfirmed. This is not “no cartridge.” No keys, certificates or cartridge contents were read |

Native input, optical ring buffer, cursor, NFC mailbox and UDP were checked on console. Worker restart/stop and fresh-session graphics integration were checked; a repeated cursor freeze was resolved in that historical session. Successful initialization alone is not qualification of a peripheral family.

## Inventory and extending evidence

`node sdk/tools/audit-loaded.cjs SESSION` inventories loaded executable regions, including compatibility libraries. `node sdk/tools/audit.cjs SESSION` reads MOD0 dynamic symbols for the main module/SDK and saves private sdk-audit.json. The parser understands C++ length-prefixed namespaces, classifies imports/definitions and records module-relative offsets. Full binary module dumps are not stored in Git.

[Namespace inventory](inventory.md) counts functions, overloads, wrappers and helpers, **not supported features**. Groups include HID, IR, audio, networking, NFC/NFP and system libraries for codecs, crypto, fonts, clocks, applets, accounts, storage, display, keyboard and browser services. SmileBASIC imports do not themselves demonstrate permission or working microphone/IR/browser behavior. Its bridge traffic is separate from application UDP.

Start from sdk/tools and [native investigation](native.md). Promote a feature only after checking signatures, buffer ownership, error behavior, cleanup and meaningful results on supported hardware. Record absent equipment and raw error codes.

Structure references: [libnx HID](https://github.com/switchbrew/libnx/blob/master/nx/include/switch/services/hid.h), [NFC](https://github.com/switchbrew/libnx/blob/master/nx/include/switch/services/nfc.h), [IR](https://github.com/switchbrew/libnx/blob/master/nx/include/switch/services/irs.h), [network](https://github.com/switchbrew/libnx/blob/master/nx/include/switch/services/nifm.h), [Capstone Python](https://www.capstone-engine.org/lang_python.html). These aid interpretation but do not replace the application's actual ABI: libnx IPC wrappers and linked C++ wrappers can have different signatures.

## Languages and interpreters · historical check, 25 October 2026

| Language/format | Status |
|---|---|
| GLSL → SPIR-V | Working console GPU application path: logic, graphics and data buffers |
| HLSL → SPIR-V | Vulkan 1.0 compilation, validation and buffer ABI execution checked on PC GPU; physical Switch test still required |
| SmileBASIC | Host application's original language, used by bootstrap. Arbitrary BASIC programs running alongside the active launcher are not implemented |
| JavaScript/Python | Host orchestration, building, processing and testing; no console interpreter supplied |
| C/C++/Rust for ARM64 CPU | No custom executable loading environment. LoadModule export and ldr:ro access are insufficient evidence |
| Lua/Python/JS/WebAssembly on console | No ready interfaces for common interpreters found in six loaded module export tables. This does not prove absence of every internal interpreter; SDK provides no adapter |

A bounded custom bytecode VM could be implemented as a compute shader. That is a separate project, not loading a normal Lua/Python binary. Sequential branching workloads on GPU are not necessarily fast.

## Program sizes and transfer measurements

The legacy .izp container allows up to 64 MiB expanded content. Current GPU app limits include 1 MiB per shader, 7 MiB main data and 32 MiB per separate GPU buffer. These are format/allocation limits, not guaranteed free memory for every app combination. IZM host-package limits are specified separately in [SDK](../README.md).

Historical console write/readback of random 32 KiB, 256 KiB and 1 MiB matched exactly. In two sessions, 1 MiB writes took 112–118 ms and reads 121–127 ms: approximately 8–9 MiB/s over the ordinary control bridge, not the dedicated video transport. Native RPC transfers sequential 32 KiB chunks with fixed replies, so gigabit networking alone does not deliver line-rate transfers here.

Qualified memset initializes console-owned buffers without uploading zeros. A checked 1 MiB clear took 36 ms, including boundary/signature checks; full readback matched. Test allocations belonged only to the test and remained until SmileBASIC exit.

The empty menu counter showed 29–30 FPS in one session and 59–60 FPS in a fresh session with a shortened six-frame loop. This measured menu updates, not screen latency or all applications.

## Reproducible tools

- `sdk/tools/check-runtime.cjs SESSION`: state, RPC latency and frame count. --inventory adds loaded-module inventory; --transfer tests a dedicated 1 MiB write/read/clear from the main menu.
- `sdk/tools/probe-runtime-access.cjs SESSION`: jit:u, ldr:ro, filesystem and cartridge status. Owned handles are closed; no code loading, memory-permission changes or cartridge writes.
- `sdk/tools/check-shader-languages.cjs`: GLSL/HLSL compilation, SPIR-V validation and local GPU buffer checks.
- Stream module benchmark/check tools compare compression and live transport. Synthetic compression checks do not measure Switch display latency or real video quality. A live test that installs temporary content must remove only its own module and restore the menu.

Run service-changing tests one at a time with explicit resource ownership. Live reports belong to their session folders.

## Historical video/audio evidence

A 42-frame test on 25 October 2026 exercised real TCP receive, native DEFLATE and GPU ACK. CRC and full last-slot readback matched; the temporary module was removed.

| Synthetic workload | Mean to GPU ACK | p95 |
|---|---|---|
| 1280×720, small changes | 11.3 ms | 22.2 ms |
| 1920×1080, small changes | 11.1 ms | 23.3 ms |
| 1920×1080, fully changing incompressible data | 41.2 ms | 44.3 ms |

Each mode used two warmup and twelve measured frames: a short test, not sustained stability. Timing included worker compression, transfer, decode and ACK; excluded capture, controller input and physical scanout. The launcher stayed visible, so slot correctness did not establish physical video presentation. Router inventory and the actual TCP peer confirmed Wi-Fi. Host Ethernet negotiated 1000 Mbps, which did not establish wired console transport.

A six-second silent-PCM test accepted 132 audio buffers while independently collecting 332 input samples. After one underrun, the adaptive buffer increased from 32 to 48 ms with no further underruns in the remaining interval. Two device queues totalled 64 or 96 ms. This exercised two-channel console-speaker output; audibility, HDMI and long-term stability were not tested.

After a full docked restart with HDMI, system APIs confirmed TV/performance mode and 1920×1080. Network type independently confirmed Ethernet; handheld previously reported 1280×720/Wi-Fi. TV mode alone never proves Ethernet. Dock insertion without HDMI and seamless transitions were not established by this test.

A subsequent Ethernet test used 180 frames per profile with real GPU output. 720p reached approximately 60 FPS; Full HD reached about 60 for small changes and 57.7 for fully random data. CRC and complete readback matched; temporary content was removed. Capture, game encoding, audio, input and physical scanout were excluded. These numbers do not guarantee full-game streaming FPS.

## Native session recovery

The earlier NS2R protocol-2 experiment cached completed replies and could resume the same SmileBASIC process after a transport interruption. Historical close/stall tests succeeded. It did not install a Wi-Fi driver and could not survive a new console process. The active engines use ordinary bootstrap instead; see [historical recovery notes](../../core/session/connection-recovery.md). Do not treat experimental recovery as a current supported engine feature.
