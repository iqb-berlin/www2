WWW2_BASE_DIR := $(shell git rev-parse --show-toplevel)

include $(WWW2_BASE_DIR)/.env.www2

# exports all variables (especially those of the included .env.www2 file!)
.EXPORT_ALL_VARIABLES:

# prevents collisions of make target names with possible file names
.PHONY: www2-up www2-down www2-start www2-stop www2-status www2-logs\
	www2-config www2-system-prune www2-volumes-prune www2-images-clean\
	www2-update

# disables printing the recipe of a make target before executing it
.SILENT: prod-images-clean

# Pull newest images, create and start docker containers
www2-up:
	@if ! test $(shell docker network ls -q --filter name=app-net);\
		then docker network create app-net;\
	fi
	@if test $(REGISTRY_PATH); then printf "Login %s\n" $(REGISTRY_PATH); docker login $(REGISTRY_PATH); fi
	docker compose\
			--env-file $(WWW2_BASE_DIR)/.env.www2\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.yaml\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.prod.yaml\
		pull
	@if test $(REGISTRY_PATH); then docker logout $(REGISTRY_PATH); fi
	docker compose\
			--env-file $(WWW2_BASE_DIR)/.env.www2\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.yaml\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.prod.yaml\
		up -d

# Stop and remove docker containers
www2-down:
	docker compose\
			--env-file $(WWW2_BASE_DIR)/.env.www2\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.yaml\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.prod.yaml\
		down

# Start docker containers
www2-start:
	docker compose\
			--env-file $(WWW2_BASE_DIR)/.env.www2\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.yaml\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.prod.yaml\
		start

# Stop docker containers
www2-stop:
	docker compose\
			--env-file $(WWW2_BASE_DIR)/.env.www2\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.yaml\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.prod.yaml\
		stop

# Show status of containers
www2-status:
	docker compose\
			--env-file $(WWW2_BASE_DIR)/.env.www2\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.yaml\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.prod.yaml\
		ps -a

# Show service logs
www2-logs:
	docker compose\
			--env-file $(WWW2_BASE_DIR)/.env.www2\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.yaml\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.prod.yaml\
		logs -f

# Show services configuration
www2-config:
	docker compose\
			--env-file $(WWW2_BASE_DIR)/.env.www2\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.yaml\
			--file $(WWW2_BASE_DIR)/docker-compose.www2.prod.yaml\
		config

# Remove unused dangling images, containers, networks, etc. Data volumes will stay untouched!
www2-system-prune:
	docker system prune

# Remove all unused (not just dangling) images!
www2-images-clean: .EXPORT_ALL_VARIABLES
	if test "$(shell docker compose --env-file $(WWW2_BASE_DIR)/.env.dev config --images)";\
		then docker rmi $(shell docker compose --env-file $(WWW2_BASE_DIR)/.env.dev config --images);\
	fi

# Start application update procedure
www2-update:
	bash $(WWW2_BASE_DIR)/scripts/update.sh -s $(TAG)
