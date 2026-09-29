# www2

IQB www2 web service — a static nginx site that serves the [www2.iqb.hu-berlin.de](https://www2.iqb.hu-berlin.de)
portal landing page and the IT section (`/it/`: IQB software downloads and the
list of available PCs), running behind [Traefik](https://traefik.io/).

## How it works

- nginx (`nginxinc/nginx-unprivileged`) serves `config/assets/` as its
  document root; `landing-page.html` is the index page.
- The IT section under `/it/` consists of static pages (nginx server-side
  includes share one page chrome), the ClickOnce deployment trees of the
  IQB Windows programs (served from an external `downloads/` directory) and a
  tiny Node.js API container (`api/`, service `it-api`) that nginx proxies
  under `/it/api/`. See [IT section](#it-section-it) below.
- The page's `<base href>` still points at the live IQB domain, so untouched
  links (navigation, footer, forms, ...) keep working against the real site.
  Its CSS/JS/image references, however, use a `https://local-assets/...`
  placeholder that nginx rewrites at request time (via `sub_filter`) to
  whatever host/scheme the request actually came in on — so those assets are
  always served locally, in every environment, without hardcoding a domain.
- `config/default.conf.template` is rendered into the live nginx config by
  the image's `envsubst` entrypoint.

## Requirements

- Docker & Docker Compose
- A running Traefik reverse-proxy stack providing the external `app-net`
  Docker network (see IQB's `traefik` project) for the `www2-*` (production)
  targets. The `dev-*` targets will create a standalone `app-net` network
  themselves if one doesn't already exist.

## Configuration

- `.env.dev` is committed with safe local defaults and used as-is for
  development.
- For production, copy `.env.www2.template` to `.env.www2` and fill in the
  values. `SERVER_NAME` and `TLS_CERTIFICATE_RESOLVER` must match the values
  used by the Traefik project at `TRAEFIK_DIR`.

  ```sh
  cp .env.www2.template .env.www2
  ```

## Usage

Common operations are wrapped in `make` targets (see `Makefile` and
`scripts/make/*.mk`).

### Local development (plain HTTP, no Traefik required)

```sh
make dev-up       # create/start the container(s), serves http://localhost:${HTTP_PORT} (default 8080)
make dev-down     # stop and remove
make dev-start    # start without recreating
make dev-stop     # stop without removing
make dev-status   # show container status
make dev-logs     # follow logs
make dev-config   # print the resolved compose config
```

### Production / staging (behind Traefik, TLS)

```sh
make www2-up      # pull images, create/start the container(s)
make www2-down    # stop and remove
make www2-start   # start without recreating
make www2-stop    # stop without removing
make www2-status  # show container status
make www2-logs    # follow logs
make www2-config  # print the resolved compose config
```

### Release installations (no Git checkout)

The Makefiles resolve the installation directory from their own location, so
`make www2-up` also works in an unpacked release or an installation created by
`scripts/install.sh`. The release installer names its production Make fragment
`scripts/make/www2.mk` and its updater `scripts/update_www2.sh`; both the release
and repository updater names are supported.

All production startup paths pull only prebuilt services, build `it-api`
locally, then recreate containers using those prepared images. The API image
does not need to be published to a registry. Docker needs outbound access to
obtain the build base image and npm dependencies. A failed pull/build prevents
activation; updates no longer stop existing containers before building.

For a prerelease, select its exact published tag in the updater's version
prompt (the GitHub `latest` endpoint normally excludes prereleases). Use the
repository's existing version convention, e.g. `0.2.0-rc.1`. The updater's `-t`
option is for resuming an update, not bypassing the initial backup workflow.

The updater retains `.env.www2` and updates only its `TAG` entry. The installer
also preserves an existing `.env.www2` when installing into a nonempty directory.
A changed environment template still requires reviewing the new settings:
configure `PC_UPDATE_TOKEN`, `UPLOAD_TOKENS`, `DOWNLOADS_DIR`, and
`TRUSTED_PROXY_CIDR` before activation. ClickOnce payloads are not in a release;
transfer them separately and ensure the API can write to the downloads directory.
Keep separate backups of downloads and the API state volume.

When configuration review is required, the updater leaves containers running
and asks you to run `make www2-up` after review. Release files are nevertheless
updated in place, including bind-mounted assets; this is not an atomic whole-site
upgrade. Schedule the update accordingly and retain the release backup.

Offline deployment regression tests (no Docker daemon, network, Git checkout,
or real environment files required):

```sh
python3 -B -m unittest discover -s scripts/tests -p 'test_release_deployment.py' -v
```

### Security scanning

```sh
make scan-www2    # Trivy vulnerability scan of the nginx image
make scan-it-api  # build + Trivy vulnerability scan of the it-api image
```

## IT section (`/it/`)

Replaces the old Zope pages under `/institut/ab/it` (those URLs redirect).

| URL | What |
|---|---|
| `/it/` | EDV-Team page with the list of downloadable programs (filled from the API) |
| `/it/<App>/` | Info page of one program (description from `config/assets/it/apps.json`, version and date from the API) |
| `/it/dl/<App>/` | ClickOnce deployment tree: `setup.exe`, `<App>.application`, `Application Files/…` |
| `/it/docs/` | Manuals (PDF), committed in the repo |
| `/it/license/` | German license notice |
| `/it/available-pcs/` | List of currently free PCs, refreshed every 10 s |
| `/it/api/…` | JSON API (proxied to the `it-api` container) |

### The `downloads/` directory

The ClickOnce trees are **not** part of this repository. They live in the
directory given by `DOWNLOADS_DIR` (default `./downloads`), one folder per
app, e.g. `downloads/IQB-Kodieren/`. nginx mounts it read-only, the API
container writes to it, so on the server it must be writable by uid 1000:

```sh
mkdir -p downloads && sudo chown 1000:1000 downloads
```

The API stores releases in `downloads/.releases/<App>/<release-id>/` and
serves each app through a relative symlink at `downloads/<App>`. Publication
atomically replaces this symlink; nginx and the API can use different mount
paths. The previous deployment is reachable at `downloads/.prev/<App>/`.
Publisher metadata is stored in `downloads/<App>/.publish.json`.

The first upload over an existing ordinary app directory converts it to this
layout. That one-time conversion has a brief rename gap, with rollback on
failure and recovery at API startup after an interrupted conversion. Later
updates replace the symlink atomically. Run only one API instance per downloads
volume (upload locks and startup recovery are process-local).

Old release trees are retained and old `Application Files/` payloads are carried
forward so clients already downloading an older manifest can finish. Monitor
disk usage; no automatic release pruning is implemented. Do not edit or remove
release directories referenced by the live/previous links. Back up the entire
downloads directory, preserving relative symlinks.

For rollback, stop publishing first. If `.prev/<App>` is a symlink, read its
resolved target and create a temporary symlink next to the live app, using a
path relative to `downloads/`, then rename the temporary link over the live
link. Do not simply move the `.prev` symlink: its relative target is based on
a different directory. For an ordinary-directory backup from the first
conversion, schedule a maintenance window to restore it.

### Publishing a program (ClickOnce)

1. In Visual Studio → project properties → *Publish*: set
   **Installation URL** and **Update location** to
   `https://www2.iqb.hu-berlin.de/it/dl/<App>/` (trailing slash), the
   support URL to `https://www2.iqb.hu-berlin.de/it/<App>/`, bump the publish
   version and publish to a local folder.
2. Upload that folder with your personal token (ask the IT team; tokens are
   configured in `.env.www2` as `UPLOAD_TOKENS=name:token,…`):

   ```powershell
   $env:WWW2_UPLOAD_TOKEN = '…'
   .\scripts\publish-app.ps1 -App IQB-Kodieren -PublishDir C:\src\IQB-Kodieren\publish
   ```

   or on Linux/macOS `WWW2_UPLOAD_TOKEN=… scripts/publish-app.sh IQB-Kodieren ./publish`.

   The script zips the folder and `PUT`s it to `/it/api/apps/<App>`. The API
   checks that the archive contains `setup.exe`, exactly one
   `*.application` whose name matches `<App>`, and an `Application Files/`
   folder, then activates the new release (see the one-time directory conversion above). A `deploymentProvider`
   that does not point at this server is reported as a warning.
3. New program? Add an entry to `config/assets/it/apps.json` (id, title,
   description HTML, optional manual in `config/assets/it/docs/`) so the info
   page has a text. Without an entry the program is still listed by its id.

For the initial server migration, preserve existing installation/update URLs
and copy complete deployment trees without modifying their manifests or
bootstrappers. Both `/institut/ab/it/<App>/…` and, for the seven known apps,
`/institut/ab/<App>/…` are internally mapped to `/it/dl/<App>/…` without HTTP
redirects. The host, filename casing, and versioned payload paths must still
match the URLs embedded in each existing deployment. Other hostnames/paths
need routing on those hosts too; a www2 alias alone cannot cover them.

The publishing instructions above use the new URL for new deployments. To
upload an unchanged legacy deployment on this same host, the current helper
scripts require `-Force` (PowerShell) or `FORCE=1` (Bash); review the API's
provider warning against the preserved aliases. An optional later update-URL
migration needs a properly published/signed release available at the old URL
and a test with an already installed Windows client. Reinstallation is not
inherently required just because the web server implementation changes.

### Available PCs feed

The LAN scanner that used to `POST` to the Zope `update` script now posts to
`https://www2.iqb.hu-berlin.de/it/api/pcs` with the header
`Authorization: Bearer <PC_UPDATE_TOKEN>`. The body is unchanged: a JSON
array of strings (entries starting with `(` are shown as a footnote), or
optionally `{"list": […], "pc_max": 29}`. Optionally restrict the source
addresses with `PC_UPDATE_ALLOW_CIDRS` (comma separated IPv4 CIDRs).

```sh
curl -X POST https://www2.iqb.hu-berlin.de/it/api/pcs \
  -H "Authorization: Bearer $PC_UPDATE_TOKEN" -H "Content-Type: application/json" \
  --data-binary '[".60 ... (nur vor Ort nutzbar)", ".88 ... (nur REMOTE)", "(gem. von 1)"]'
```

A report is **fresh for 60 seconds** from the producer's last successful POST.
GET requests and browser polling do not reset this timer. The API exposes
`status` (`fresh`, `stale`, `unavailable`), `ageMs`, `staleAfterMs`, and `stale`.
Missing/invalid timestamps are unavailable. At 60 seconds the page hides the
PC list and free counts and displays an outdated-data warning with the last
report time. A fresh empty report means no PCs are free. Network errors have
a separate message; requests time out after eight seconds. A browser timer
also expires the display if a request hangs. The producer should report more
frequently than once a minute, even when its list has not changed.

For production behind Traefik, set `TRUSTED_PROXY_CIDR` to the exact Traefik
peer address (prefer `/32`) seen by nginx, or a dedicated trusted proxy subnet.
nginx resolves `X-Forwarded-For` only for this peer and overwrites `X-Real-IP`
before forwarding to the private API. Do not trust `0.0.0.0/0`, arbitrary
clients, or a shared subnet containing untrusted containers. If Traefik itself
is behind another proxy, configure its forwarded-header trust as well.
The loopback default is for direct development, not production behind Traefik.

To locate the existing producer, search old Zope/reverse-proxy access logs for
`/available_pcs/update` (not the browser's `getAvailablePCs` requests). Identify
the source address, authenticated account, user agent, and reporting cadence;
then inspect scheduled tasks/services/scripts on the corresponding machine.
Check both Windows Task Scheduler and Linux cron/systemd timers as applicable.
Search scripts/configuration for `available_pcs`, `www2.iqb.hu-berlin.de`,
`getAvailablePCs`, and the old update URL. A proxy/NAT address must be traced
through the upstream logs or IT inventory. The export contains the receiver,
not the program which measures availability.

### API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/it/api/health` | – | liveness |
| GET | `/it/api/pcs` | – | `{updatedAt, timestamp, pc_max, list, footnotes, remote, total, percentRemote}` |
| POST | `/it/api/pcs` | `PC_UPDATE_TOKEN` | store the list (204) |
| GET | `/it/api/apps` | – | `{apps: [{id, version, published, publishedAt, publishedBy, setupUrl, manifestUrl, …}]}` |
| GET | `/it/api/apps/<App>` | – | one app or 404 |
| PUT | `/it/api/apps/<App>` | one of `UPLOAD_TOKENS` | body `application/zip`; 201 new / 200 replaced, 4xx with `{errors: […]}` |

## Structure

- `docker-compose.yaml` / `docker-compose.www2.yaml` (symlink) — base
  service definition (image, volumes, network).
- `docker-compose.override.yaml` — dev-mode Traefik labels and a published
  port; auto-merged by plain `docker compose` commands.
- `docker-compose.www2.prod.yaml` — production Traefik labels (TLS,
  `websecure` entrypoint).
- `config/default.conf.template` — nginx server configuration template.
- `config/assets/` — served document root: `landing-page.html` plus its
  local CSS/JS/image assets; `config/assets/it/` holds the IT section pages,
  their SSI fragments (`_inc/`), `apps.json` and the manuals (`docs/`).
- `api/` — the `it-api` Node.js service (Dockerfile, `src/`).
- `downloads/` — ClickOnce deployment trees (git-ignored, see above).
- `scripts/publish-app.ps1` / `scripts/publish-app.sh` — upload a ClickOnce
  publish folder to the server.

## Verification

Run the API and browser-logic regression tests with Node.js 22 or newer:

```sh
cd api
npm test
```

For an isolated integration check, build the API image first, then run:

```sh
docker build -t iqb-berlin/www2-it-api:latest api
python3 scripts/test-it-stack.py
```

The integration check uses local images (including
`nginxinc/nginx-unprivileged:stable`), an isolated Compose network, an ephemeral
localhost port, and temporary data inside the workspace for Docker Desktop
file sharing. It checks fresh/stale reports, forwarded-address spoof rejection,
a trusted proxy request, ZIP publication, legacy download URLs, MIME types,
retained payloads, and hidden-file protection, then removes the test containers
and data. It does not alter the configured production downloads directory.
