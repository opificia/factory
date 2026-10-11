# ADR-0003: Host the website on Scaleway

- **Status:** proposed
- **Date:** 2026-10-11
- **Deciders:** the project steward
- **Related:** [`website/README.md`](../../website/README.md), [`SOVEREIGNTY.md`](../../SOVEREIGNTY.md) commitment 8

## Context

Opificia AI has a static website in `website/`: HTML, CSS, fonts and images, with no build step and no scripts. It needs a host that serves it over HTTPS on `opificia.ai`, and a way to redeploy it when it changes.

The project intends its own infrastructure to run on providers headquartered in Europe (commitment 8 in `SOVEREIGNTY.md`). The website is the first piece of infrastructure the project runs, so it sets the example.

## Considered options

1. **Scaleway Object Storage behind Scaleway Edge Services.** Files in a bucket in Paris (`fr-par`), served through Edge Services with a managed Let's Encrypt certificate.
2. **GitHub Pages.** Free and simple, but operated by a company headquartered outside Europe.
3. **A virtual machine with a web server**, at any European provider. More control, but more to maintain and patch for a single static page.

## Decision

We host the website on Scaleway (option 1), in the `fr-par` region:

- the bucket `opificia-website` holds the files, with the static-website feature on and listing of the bucket off;
- an Edge Services pipeline serves the bucket over HTTPS, with a 5-minute cache;
- `opificia.ai` points to the pipeline through Scaleway DNS;
- the `Website` workflow (`.github/workflows/website.yml`) uploads `website/` to the bucket on every change to `main`.

Scaleway is headquartered in France. Nothing about the site depends on Scaleway-specific features: any static file host can serve the same folder.

## Consequences

- The site runs on European infrastructure, in line with commitment 8.
- The cost is low: the Edge Services Starter plan plus a few cents for storage and the certificate.
- Deployments need a Scaleway API key in the repository secrets (`SCW_ACCESS_KEY`, `SCW_SECRET_KEY`). It belongs to a dedicated IAM application, `opificia-website-deploy`, which can only read, write and delete objects in the project. It cannot change buckets, Edge Services or DNS.
- Because the deploy key cannot purge the Edge cache, a change can take up to 5 minutes to appear.
- Moving to another host means copying one folder and changing one DNS record.

### Sovereignty impact

Supports commitment 8: the project's own website runs on a provider headquartered in Europe. Supports commitment 2 for the site itself: the page loads nothing from other servers. No impact on the other commitments, which concern the software rather than the project's infrastructure.

## More information

- Scaleway Edge Services: <https://www.scaleway.com/en/edge-services/>
- Scaleway Object Storage: <https://www.scaleway.com/en/object-storage/>
