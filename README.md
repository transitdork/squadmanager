# Squad Manager

Single-file GitHub Pages app for basketball squad, substitution, game-time, and report management.

## Files

- `index.html` is the app GitHub Pages serves.
- `version.txt` must match `APP_VERSION` inside `index.html`.
- `sw.js` keeps a copy of the app available offline after an online visit.

## Update Flow

1. Ask Codex to make the change.
2. Codex edits `index.html`.
3. Bump `APP_VERSION` in `index.html`.
4. Put the same version in `version.txt`.
5. Open `index.html` locally and test with sample data. Run `node --test tests/squad-manager.test.cjs` for the automated checks.
6. Check Auto, Portrait, and Landscape on an iPad, and try opening the hosted app offline after one online visit.
7. After approval, publish `index.html`, `version.txt`, and `sw.js` together to the same GitHub Pages folder. The tests do not need to be uploaded.

The app checks `version.txt` beside the hosted page for updates. It does not prompt for a refresh during an unfinished game.

## Notes

The app stores data in the browser using `localStorage`. Clearing browser data will remove saved teams, reports, settings, and active game state unless exported first.
Keep the existing Pages URL and test with sample data in a local preview. The team export is not a full backup of the app.

## Game Timing And Corrections

- Reaching zero alerts you but does not stop recording. End each quarter, half, or game manually when play finishes. The remaining clock shows `+M:SS` during extra recorded time.
- Reports retain actual period endings. Chart shading shows time beyond a period's nominal duration; later periods start from the actual preceding ending.
- TIMEOUT asks who called it. Calls are timestamped, marked on report timelines, and counted separately for each half and caller. Existing league-specific timeout clock rules still apply.
- At Full Time, use **Edit Events** to add, correct, or delete scores, fouls, player stats, and timeouts. Enter elapsed game time and the corresponding period. Attribution, totals, charts, and new exports use the corrected events. Court-time and substitution records are not changed by event corrections.
- Save the report again after correcting the current game. **Edit Events** in a saved report saves corrections immediately. Generate exports again after editing; downloaded files do not change automatically.
- Existing saves remain readable, but previously unrecorded extra time or events cannot be reconstructed automatically.
