# PC control panel

This folder contains the interface you see in the browser. It lets you configure hardware, choose an engine, install a bootstrap, launch/stop a session and manage the console module catalog.

Start the whole platform through the root `start.sh`, not by opening `ui/index.html` directly. The interface needs its local server. Closing the browser does not stop a console session.

| Path | What it does |
| --- | --- |
| `ui/index.html` | Page structure |
| `ui/style.css` | Colors, layout, spacing and responsive behavior |
| `ui/app.js` | Interface behavior and server requests |
| `http.cjs` | Local HTTP interface and request checks |
| `controller.cjs` | Connects user actions to platform services |
| `profile.json` | Shipped defaults, not your private saved settings |

Keep application-specific capture, audio and game logic inside the relevant module. Keep engine START/bootstrap rules inside that engine. Hardware layouts come from hardware descriptors, not a hardcoded list of boards in the page.

For layout edits, use a temporary preview before starting hardware. [Main guide](../README.md) · [FAQ](../FAQ.md) · [Release/testing guide](../distribution/README-development.md).
