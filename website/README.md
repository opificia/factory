# Website

This folder holds the source of the Opificia AI website, a single static page.

## What it is

- **Plain HTML and CSS.** No build step, no framework, no JavaScript.
- **Nothing from other servers.** Fonts and images are served from this folder. The page sets no cookies and has no analytics. This follows commitment 2 (no phone-home) in [`SOVEREIGNTY.md`](../SOVEREIGNTY.md).
- **Brand book tokens.** Colours, type and the rack device come from the Opificia AI brand book. The page follows the light or dark setting of your system.

## Preview it

Open `index.html` in a browser, or serve the folder locally:

```sh
python3 -m http.server --directory website 8000
```

Then open <http://localhost:8000>.

## Files

| Path | What it is | Licence |
| --- | --- | --- |
| `index.html`, `styles.css`, `README.md` | The page | CC-BY-4.0 |
| `fonts/` | Archivo and IBM Plex Mono, with their licence files | OFL-1.1 |
| `assets/` | Logo, favicon and social preview image, copied from `brand/` | Trademark; see [`TRADEMARKS.md`](../TRADEMARKS.md) |

Do not edit the files in `assets/`. Copy new versions from `brand/` instead.

## Deployment

Where the site is hosted has not been decided yet. Any server that can serve static files over HTTPS will do. In line with commitment 8 in `SOVEREIGNTY.md`, we intend to host it with a provider headquartered in Europe. Serve the contents of this folder at the root of <https://opificia.ai>; the social preview tags expect `assets/` at that location.

## Writing for the site

Copy on the site follows the same rules as the rest of the project: plain European English, sentence case, no hype and no claims we cannot back up. The page describes what Opificia will do as intentions, because there is no product code yet. Keep it that way until there is.
