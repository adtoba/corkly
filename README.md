# Corkly 📌

A playful desktop pinboard for **macOS and Windows** (Electron). Pin sticky notes, index cards,
polaroid photos, checklists and link tickets onto a cork board — then tie them together with yarn,
detective-board style.

## Run it

```bash
npm install
npm start
```

## Ship it

See **[RELEASING.md](RELEASING.md)** — push a version tag and GitHub Actions builds the Mac `.dmg`
and Windows `.exe` and publishes them (with auto-updates) on GitHub Releases.

## Things to try

| Do this | What happens |
| --- | --- |
| Click or **drag** an item off the wooden shelf | It drops onto the board with a bounce |
| Double-click empty board | New sticky note right there |
| Drag anything | It lifts, swings on its pin, and settles when you let go |
| Right-click an item | Paper colour, pushpin / washi tape, wiggle, duplicate, crumple & toss |
| **Yarn** (Y) → click one thing, then another | Ties them together with a sagging, bouncy string |
| Click a string | Scissors appear to cut it |
| Tick every box on a checklist | DONE! stamp + confetti |
| Drop / paste images | They become polaroids |
| Paste a URL or text | Link ticket or sticky note |
| Right-click empty board → Shake the board! | Everything jiggles |
| Camera button | Save the board as a PNG |
| Corners button (or **H**) | Just the board — hides the top bar, the shelf and the thick frame. Hover the top edge (or press H / Esc) to bring them back |

**Shortcuts:** N note · C card · H hide/show toolbars · P photo · L list · K link · Y yarn · ⌘/Ctrl+Z undo · ⇧⌘Z / Ctrl+Y redo ·
⌘/Ctrl+D duplicate · Delete to toss · ⌘/Ctrl+0 fit everything · scroll to pan · pinch / ⌘-scroll to zoom.

## Desktop widget & startup

- **Desktop widget** — click the shrink button in the top bar (or pick it in Settings / the tray menu).
  Corkly becomes a small frameless board in the corner of your screen, stays out of the Dock/taskbar,
  and lives in the **menu bar (Mac) / system tray (Windows)**. The × tucks it away; the expand button
  brings back the full window.
- **Opens when your computer starts** — on by default, and it opens as the widget. Turn either off in
  **Settings** (gear button, ⌘/Ctrl+,) or from the tray menu. This only registers for the *installed*
  app (`npm run dist:*`), not while running `npm start`.
- **Keep the widget on top**, **keep running when closed**, and a global **⌘⇧Space / Ctrl+Shift+Space**
  show/hide shortcut are all in Settings too. The window sizes and positions are remembered for each mode.

Boards are saved automatically to the app's data folder (`corkly-boards.json`, `corkly-settings.json`
and an `images/` folder).

## Structure

```
src/main.js        Electron main process — window, saving, images, export
src/preload.js     Safe bridge exposed to the page as window.corkly
src/renderer/      The board itself (index.html, styles.css, app.js)
src/assets/        Tray / menu-bar icons and the window icon
build/icon.png     App icon (electron-builder makes .icns / .ico from it)
```
