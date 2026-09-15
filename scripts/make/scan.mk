WWW2_BASE_DIR := $(shell git rev-parse --show-toplevel)
NGINX_IMAGE := $(shell docker compose --env-file $(WWW2_BASE_DIR)/.env.dev config --images | grep nginx)

# Docker Hub Proxy (Docker Hub: REGISTRY_PATH := )
REGISTRY_PATH := scm.cms.hu-berlin.de:443/iqb/dependency_proxy/containers/
#REGISTRY_PATH :=

TRIVY_VERSION := aquasec/trivy:latest

# prevents collisions of make target names with possible file names
.PHONY: scan-registry-login scan-registry-logout scan-www2

# disables printing the recipe of a make target before executing it
.SILENT: scan-registry-login scan-registry-logout

# Log in to selected registry
scan-registry-login:
	if test $(REGISTRY_PATH); then printf "Login %s\n" $(REGISTRY_PATH); docker login $(REGISTRY_PATH); fi

# Log out of selected registry
scan-registry-logout:
	if test $(REGISTRY_PATH); then docker logout $(REGISTRY_PATH); fi

# scans www2 image for security vulnerabilities
scan-www2: scan-registry-login
	docker run\
			--rm\
			--volume /var/run/docker.sock:/var/run/docker.sock\
			--volume ${HOME}/Library/Caches:/root/.cache/\
		$(TRIVY_VERSION) --version
	docker run\
			--rm\
			--volume /var/run/docker.sock:/var/run/docker.sock\
			--volume ${HOME}/Library/Caches:/root/.cache/\
		$(TRIVY_VERSION)\
			image --download-db-only --no-progress --timeout 30m0s
	docker run\
			--rm\
			--volume /var/run/docker.sock:/var/run/docker.sock\
			--volume ${HOME}/Library/Caches:/root/.cache/\
		$(TRIVY_VERSION)\
			image\
					--scanners vuln\
					--ignore-unfixed\
					--severity CRITICAL\
				$(NGINX_IMAGE)
