# Squad Manager

Single-file GitHub Pages app for basketball squad, substitution, game-time, and report management.

## Files

- `index.html` is the app GitHub Pages serves.
- `version.txt` must match `APP_VERSION` inside `index.html`.

## Update Flow

1. Ask Codex to make the change.
2. Codex edits `index.html`.
3. Bump `APP_VERSION` in `index.html`.
4. Put the same version in `version.txt`.
5. Test locally.
6. Commit and push to GitHub.

The app checks `https://transitdork.github.io/squadmanager/version.txt` to detect when a newer version has been published.

## Notes

The app stores data in the browser using `localStorage`. Clearing browser data will remove saved teams, reports, settings, and active game state unless exported first.
