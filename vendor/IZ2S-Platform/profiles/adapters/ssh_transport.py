"""Compatibility entry for the hardware-owned input transport."""
from pathlib import Path
import runpy
globals().update(runpy.run_path(str(Path(__file__).resolve().parents[2]/"hardware/transports/ssh-gadget/ssh_transport.py"), run_name=__name__))
