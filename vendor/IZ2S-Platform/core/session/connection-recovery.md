# Connection recovery: historical protocol notes

The active supplied engines use the standard bootstrap. **Automatic native-session recovery is not enabled by this platform.** This document records the earlier NS2R experiment; it is not an installation guide for current engines.

On 25 October 2026, an experimental protocol 2 bootstrap tracked the last executed command and cached its response. A lost response could be returned without repeating a completed operation. Partial packets were assembled before execution. A stalled transport was detected after 30 seconds; the same SmileBASIC process could reconnect within 120 seconds. Restarting SmileBASIC or the console created a new process and invalidated the old native addresses.

Historical console tests deliberately closed the host TCP socket and separately stalled its reads. Cached replies returned after 4 ms and 93 ms after detection respectively, and the existing menu continued responding. These were transport tests, not physical Wi-Fi reconnection measurements. The user later explained that observed access-point disconnects accompanied manual console restarts; they did not prove spontaneous driver failures.

The experimental installer wrote a separate NS2R, verified complete readback and preserved NS2. That experiment does not justify substituting modified source under an unchanged save name. Current installation uses each engine's exact bootstrap and explicit LIST/SAVE slot recipe.

A normal package cannot install or replace a system Wi-Fi driver from SmileBASIC. Available networking APIs use system NIFM/WLAN services. Stream transport recovery and native control-session recovery are separate features.

References: [NIFM](https://switchbrew.org/wiki/Network_Interface_services), [WLAN](https://switchbrew.org/wiki/WLAN_services), [SmileBASIC save format](https://github.com/plutooo/smilehax/blob/master/scripts/make_script.py).
