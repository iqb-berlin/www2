WWW2_BASE_DIR := $(shell git rev-parse --show-toplevel)
MK_FILE_DIR := $(WWW2_BASE_DIR)/scripts/make

dev-registry-login:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-registry-logout:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-up:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-down:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-start:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-stop:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-status:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-logs:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-config:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-system-prune:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@
dev-images-clean:
	$(MAKE) -f $(MK_FILE_DIR)/dev.mk -C $(MK_FILE_DIR) $@

www2-up:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
www2-down:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
www2-start:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
www2-stop:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
www2-status:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
www2-logs:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
www2-config:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
www2-system-prune:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
www2-images-clean:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@
www2-update:
	$(MAKE) -f $(MK_FILE_DIR)/prod.mk -C $(MK_FILE_DIR) $@

scan-registry-login:
	$(MAKE) -f $(MK_FILE_DIR)/scan.mk -C $(MK_FILE_DIR) $@
scan-registry-logout:
	$(MAKE) -f $(MK_FILE_DIR)/scan.mk -C $(MK_FILE_DIR) $@
scan-www2:
	$(MAKE) -f $(MK_FILE_DIR)/scan.mk -C $(MK_FILE_DIR) $@
