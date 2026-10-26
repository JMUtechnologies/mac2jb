# Bundled USB gadget driver

`usbgadget.kext` is the maintainer's tested, locally built arm64e driver, version 1.01, identifier `gay.bowser.usbgadget`. Its personal development signature was removed from a copy; the installed working driver was not included with its certificate. The unsigned copy passed reboot/loading, USB enumeration, and typing tests reported by the maintainer in their setup. Other Macs/macOS versions remain unverified.

Executable SHA-256: `a32119c7908098c49c2540a17aad4d172378de969885ad4f4a752bdb8ef91308`.
Mach-O UUID: `124391F6-0CFF-32E0-8884-6F6360DF5D1C`.
Build metadata: Xcode 26.6 / macOS SDK 26.5; minimum OS recorded as 11. This is not a claim of compatibility with every OS from 11 onward.

Upstream: https://github.com/shinyquagsire23/macos_usb_gadget_poc
The bundled source snapshot is at `../vendor/macos_usb_gadget_poc/usbgadget/`, pinned in `../upstream.lock`. This binary is a local build, not the upstream prebuilt artifact; bit-for-bit reproducibility against that snapshot has not been established. Source-build instructions remain in the root README.

Copyright © 2022 Max Thomas. Upstream MIT license: `../vendor/macos_usb_gadget_poc/usbgadget/LICENSE`. Apple-derived source notices and APSL text are retained in `../vendor/macos_usb_gadget_poc/`. These licenses are also included alongside this file for standalone driver packaging.

macOS must permit loading this unsigned driver. Fully disabled SIP is the maintainer-tested setup, not an installer requirement; compatible partial/custom SIP configurations are accepted. The installer records `csrutil status` only for diagnostics and preserves the actual `kmutil` load error and exit code. The GUI checks whether the driver is loaded and whether a restart is pending. Complete any kernel-extension approval/restart prompts. Neither the GUI nor the installer changes startup security, SIP, or AMFI.

Installing this unsigned driver does not sign it or establish that fully
re-enabling SIP afterward will preserve compatibility. Apple verifies kext
signatures before AuxKC inclusion when SIP is on; a subsequent AuxKC rebuild
may reject the unsigned copy. mac2jb has not verified installing and then
re-enabling SIP, including behavior with a cached AuxKC. Compatible partial/custom settings
are a separate case. See [Apple's kernel-extension policy](https://support.apple.com/en-ca/guide/security/sec8e454101b/web).

The driver is upstream work by Max Thomas / ShinyQuagsire, with the local build and unsigned-copy testing performed by the mac2jb maintainer.

From the complete source checkout: `bash scripts/install-driver.sh`. To validate the bundled files without installing or loading: `bash scripts/install-driver.sh --verify`.

The installer preserves an existing driver under `/Library/Extensions/.mac2jb-usbgadget-backup-<UUID>` and prints the exact path. Do not delete that backup until the replacement has been verified after a restart. If loading fails, the installed copy and backup remain available for diagnosis/recovery.

Every installation refreshes
`/Library/Extensions/.mac2jb-usbgadget-restart-required`. If its timestamp is
newer than the current boot, the GUI requires a restart even if the driver
appears in `kmutil`'s loaded list. After the latest installation, complete the
requested restart and refresh the driver check rather than reinstalling again.
Do not remove the marker to bypass the existing restart policy.

A user-space `mac2jb-send` or `mac2jb-commands` crash is distinct from driver
loading. Keep the helper's macOS crash report and mac2jb session logs; a crash
alone is not evidence that the kext needs reinstalling. The accompanying
libusbd ownership fix changes the user-space library, not this bundled kext.
