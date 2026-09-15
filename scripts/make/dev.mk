WWW2_BASE_DIR := $(shell git rev-parse --show-toplevel)

include $(WWW2_BASE_DIR)/.env.dev

# exports all variables (especially those of the included .env.dev file!)
.EXPORT_ALL_VARIABLES:

# prevents collisions of make target names with possible file names
.PHONY: dev-registry-login dev-registry-logout dev-up dev-down dev-start dev-stop dev-status dev-logs dev-config\
dev-system-prune dev-images-clean

# disables printing the recipe of a make target before executing it
.SILENT: dev-registry-login dev-registry-logout dev-volumes-clean dev-images-clean

# Log in to selected registry (see .env.dev file)
dev-registry-login:
	if test $(REGISTRY_PATH); then printf "Login %s\n" $(REGISTRY_PATH); docker login $(REGISTRY_PATH); fi

# Log out of selected registry (see .env.dev file)
dev-registry-logout:
	if test $(REGISTRY_PATH); then docker logout $(REGISTRY_PATH); fi

# Create and start all docker containers
dev-up:
	@if ! test $(shell docker network ls -q --filter name=app-net);\
		then docker network create app-net;\
	fi
	docker compose --env-file $(WWW2_BASE_DIR)/.env.dev up -d

# Stop and remove all docker containers, preserve data volumes
dev-down:
	docker compose --env-file $(WWW2_BASE_DIR)/.env.dev down
	@if test $(shell docker network ls -q --filter name=app-net);\
		then docker network rm $(shell docker network ls -q -f name=app-net);\
	fi

# Start docker containers
dev-start:
	docker compose --env-file $(WWW2_BASE_DIR)/.env.dev start

# Stop docker containers
dev-stop:
	docker compose --env-file $(WWW2_BASE_DIR)/.env.dev stop

# Show status of containers
dev-status:
	docker compose --env-file $(WWW2_BASE_DIR)/.env.dev ps -a

# Show service logs
dev-logs:
	docker compose --env-file $(WWW2_BASE_DIR)/.env.dev logs -f

# Show services configuration
dev-config:
	docker compose --env-file $(WWW2_BASE_DIR)/.env.dev config

# Remove all stopped containers, all unused networks, all dangling images, and all dangling cache
dev-system-prune:
	docker system prune

# Remove all unused (not just dangling) images!
dev-images-clean:
	if test "$(shell docker compose --env-file $(WWW2_BASE_DIR)/.env.dev config --images)";\
		then docker rmi $(shell docker compose --env-file $(WWW2_BASE_DIR)/.env.dev config --images);\
	fi
