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

Then open `http://localhost:8000` in your browser.

## Files

| Path | What it is | Licence |
| --- | --- | --- |
| `index.html`, `styles.css`, `README.md` | The page | CC-BY-4.0 |
| `fonts/` | Archivo and IBM Plex Mono, with their licence files | OFL-1.1 |
| `assets/` | Logo, favicon and social preview image, copied from `brand/` | Trademark; see [`TRADEMARKS.md`](../TRADEMARKS.md) |

Do not edit the files in `assets/`. Copy new versions from `brand/` instead.

## Deployment

The site is hosted on Scaleway in Paris (`fr-par`), as recorded in [ADR 0003](../docs/adr/0003-host-the-website-on-scaleway.md):

- the files live in the Object Storage bucket `opificia-website`;
- a Scaleway Edge Services pipeline serves them over HTTPS, with a 5-minute cache;
- `opificia.ai` will point to that pipeline once its DNS moves to Scaleway. Until then, the site is at `https://8b5f22f6-2edf-45a8-9124-569e60b27c5a.svc.edge.scw.cloud/`.

**Every change to `website/` on `main` is deployed automatically** by the [`Website` workflow](../.github/workflows/website.yml). It uploads this folder to the bucket (without this README), removes files that no longer exist, and checks that the page responds. Changes appear within 5 minutes. A maintainer can also run the workflow by hand from the Actions tab.

The workflow uses a Scaleway API key stored as the repository secrets `SCW_ACCESS_KEY` and `SCW_SECRET_KEY`. The key belongs to the IAM application `opificia-website-deploy` and can only read, write and delete objects. It cannot change the bucket, Edge Services or DNS.

## Writing for the site

Copy on the site follows the same rules as the rest of the project: plain European English, sentence case, no hype and no claims we cannot back up. The page describes what Opificia will do as intentions, because there is no product code yet. Keep it that way until there is.
