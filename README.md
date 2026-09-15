# www2

IQB www2 landing page service — a static nginx site that serves the [www2.iqb.hu-berlin.de](https://www2.iqb.hu-berlin.de)
portal landing page, running behind [Traefik](https://traefik.io/).

## How it works

- nginx (`nginxinc/nginx-unprivileged`) serves `config/assets/` as its
  document root; `landing-page.html` is the index page.
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

### Security scanning

```sh
make scan-www2    # Trivy vulnerability scan of the nginx image
```

## Structure

- `docker-compose.yaml` / `docker-compose.www2.yaml` (symlink) — base
  service definition (image, volumes, network).
- `docker-compose.override.yaml` — dev-mode Traefik labels and a published
  port; auto-merged by plain `docker compose` commands.
- `docker-compose.www2.prod.yaml` — production Traefik labels (TLS,
  `websecure` entrypoint).
- `config/default.conf.template` — nginx server configuration template.
- `config/assets/` — served document root: `landing-page.html` plus its
  local CSS/JS/image assets.
