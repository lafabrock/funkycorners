# Funky Corners — The Crates

A searchable archive of every show of the [Funky Corners Show](https://www.mixcloud.com/FunkyCorners/)
(T_Wheels, Albany NY): shows, songs, artists, how many times each record was spun, and a player
that jumps straight to any track.

## Files
- `index.html`, `style.css`, `app.js`: the site (static, no framework, no backend)
- `data/shows.json`: all shows and tracklists (generated)
- `tools/update_data.py`: rebuilds `data/shows.json` from the Mixcloud profile FunkyCorners
- `.github/workflows/update.yml`: runs the update every Friday and Sunday, commits the data, Pages redeploys

## Setup on GitHub
1. Settings → Pages → Deploy from branch → `main` / root.
2. Actions tab → "Update archive" → Run workflow (first run fetches all ~770 shows, a few minutes).

## Restyle
Colors and fonts are CSS variables at the top of `style.css`.

## Local test
`pip install requests && python3 tools/update_data.py` then `python3 -m http.server 8000`.
