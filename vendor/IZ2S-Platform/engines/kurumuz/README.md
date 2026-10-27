# ns2jb by kurumuz

## Everyday use

Choose this engine explicitly and install its original source before launching. Its current save name is NS2K and its bootstrap takes five START arguments, unlike IZMYSH's nine. A host-side rename does not update a program already saved on Switch. For Original mode, Keep RPC active (--rpc) is optional; IZlauncher keeps the needed session active automatically.

[Main README](../../README.md) · [Plain-English FAQ](../../FAQ.md)

The original server belongs in `upstream/`, pinned to commit `eb2bdec8f3907c5830eb01fb9d55797af7403579`. The adapter does not modify upstream source. Download it through the panel or copy the complete server manually; RPC and pipeline libraries are required in addition to run.cjs and bootstrap.bas. Downloaded engines are excluded from the clean release.

## Installation and launch

Choose an empty slot 0–3. For slot 2: `LIST 2:1`, exact source entry, then `SAVE "TXT:NS2K",2`. Original bootstrap: 229 lines, 8084 bytes, SHA-256 `ad1de5ab9892fc3c9eb0eb9a3a36f6af64e938e715ce08b56860f0848281f837`. Confirm saving separately. Installation does not execute RUN/REMOVE/START or overwrite the IZMYSH save.

After a full console restart, Launch loads NS2K into slot 0, enters RUN, one REMOVE and a fresh **five-argument START** on port 39380. Use fresh SmileBASIC Direct for each attempt; do not repeat memory preparation after an error in the same process.

## Original and RPC

Without **Keep RPC active (--rpc)**, upstream `run.cjs IP` performs its FS check and exits. With the option, `run.cjs --rpc IP` stays active after `4/4 verified. SmileBASIC RPC...` until Stop. The setting is stored for this engine. Original logs are in `runs/` inside its pinned server copy under `data/extensions/`.

IZlauncher always starts the selected shell independently of the saved Original checkbox. RPC is held automatically. Original `connection`, `NativeClient` and `qualify` from `upstream/engine/lib` provide the qualified native session; the Original FS demonstration is not run. Logs use platform `data/sessions/launcher-*`.

Ordinary Launch does not dump firmware. The standard bootstrap does not promise recovery after a lost native session. A host SAVE record is user confirmation, not a console file readback.
