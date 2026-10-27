# ns2jb by pepsipu

Original mode runs the upstream ns2jb workflow. IZlauncher is not supported by this adapter.

The platform ships the adapter and an empty manual installation location, not the original server source. In the panel, select **Original** and this engine, then use **Download original engine**. Alternatively, copy the complete upstream repository into this folder's `upstream/` directory and choose **Check manual folder**. Required files and bootstrap checksum come from `engine.json`; do not copy only one server file.

Use the panel's installation/launch sequence. The current save name is `NS2P`; installation slot 0 is the default, and slots 1–3 are selectable. Back up existing source and named saves before entry. A nine-argument START is generated for a fresh launch; an old command or another engine's saved program is not a substitute.

Source entry, Save and Launch are separate actions. After saving, fully restart Switch and open SmileBASIC Direct before launching. The adapter leaves original upstream source unchanged. Read `engine.json` and the upstream source for attribution/revision; preserve its license notices.

[Engine overview](../README.md) · [FAQ](../../FAQ.md#first-console-setup).
