# Tijaru backend — dev + production docker stacks.
#   make help        list targets
#   make up          dev stack   (docker-compose.yml,      ports 3002 / 5433)
#   make deploy      prod stack  (docker-compose.prod.yml, no host ports)

DEV     := docker compose -f docker-compose.yml
PROD    := docker compose -f docker-compose.prod.yml --env-file .env.prod
ENVPROD := .env.prod
PG_CTR  ?= stock-postgres
PG_USER ?= stock
PG_DB   ?= stock

.DEFAULT_GOAL := help
.PHONY: help up down logs ps seed dev-migrate \
        deploy prod-build prod-up prod-down prod-restart prod-logs prod-ps \
        prod-migrate prod-db-up prod-db-verify prod-db-status \
        prod-psql prod-backup prod-config check-env-prod \
        db-up db-down db-verify db-status db-new tap db-backup \
        db-dump-tenants db-load-tenants prod-dump-tenants prod-load-tenants

help: ## List targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ─── dev ───────────────────────────────────────────────────────────────────
up: ## Start dev stack (api :3002, postgres :5433)
	$(DEV) up -d --build

down: ## Stop dev stack (keeps volumes)
	$(DEV) down

logs: ## Tail dev backend logs
	$(DEV) logs -f backend

ps: ## Dev stack status
	$(DEV) ps

seed: ## Recreate dev backend with demo data
	SEED_DEMO=true $(DEV) up -d --force-recreate backend

dev-migrate: ## Apply pending migrations in the dev container
	$(DEV) exec backend npx prisma migrate deploy

# ─── sqitch ────────────────────────────────────────────────────────────────
SQITCH := ./sqitch

db-up: ## Deploy all sqitch migrations + verify
	$(SQITCH) deploy tijaru && $(SQITCH) verify tijaru

db-down: ## Revert all sqitch migrations
	$(SQITCH) revert -y tijaru

db-verify: ## Verify sqitch migrations
	$(SQITCH) verify tijaru

db-status: ## Show sqitch migration status
	$(SQITCH) status tijaru

db-new: ## Add new migration: make db-new CHANGE=name DESC="description"
	$(SQITCH) add $(CHANGE) -n "$(DESC)"

tap: ## Run pgTAP tests
	@docker exec $(PG_CTR) rm -rf /tmp/tijaru-tests && docker exec $(PG_CTR) mkdir -p /tmp/tijaru-tests
	@for f in migrations/tests/*.sql; do \
		docker cp "$$f" $(PG_CTR):/tmp/tijaru-tests/$$(basename "$$f"); \
	done
	@docker exec $(PG_CTR) sh -c '\
		for f in /tmp/tijaru-tests/*.sql; do \
			echo "=== $$f ==="; \
			psql -U $(PG_USER) -d $(PG_DB) -f "$$f"; \
		done'

TENANT_DUMP := tenants-backup.sql

db-backup: ## Full dev DB backup to backup-dev-<timestamp>.sql
	@f=backup-dev-$$(date -u +%Y%m%d-%H%M%S).sql; \
	docker exec $(PG_CTR) pg_dump -U $(PG_USER) -d $(PG_DB) > $$f; \
	echo "wrote $$f ($$(wc -l < $$f) lines)"

db-dump-tenants: ## Dump businesses + users to tenants-backup.sql (dev)
	@docker exec $(PG_CTR) pg_dump -U $(PG_USER) -d $(PG_DB) \
		--data-only --no-owner --no-privileges \
		--table='app.businesses' --table='app_auth.users' \
		> $(TENANT_DUMP) && echo "wrote $(TENANT_DUMP) ($$(wc -l < $(TENANT_DUMP)) lines)"

db-load-tenants: ## Load tenants-backup.sql into dev DB (new schema)
	@test -f $(TENANT_DUMP) || { echo "$(TENANT_DUMP) not found. Run: make db-dump-tenants first"; exit 1; }
	@docker exec -i $(PG_CTR) psql -U $(PG_USER) -d $(PG_DB) < $(TENANT_DUMP) \
		&& echo "loaded $(TENANT_DUMP) into dev DB"

tap-full: ## Deploy + verify + run pgTAP tests
	@$(MAKE) db-up
	@$(MAKE) tap

# ─── prod ──────────────────────────────────────────────────────────────────
check-env-prod:
	@test -f $(ENVPROD) || { \
	  echo "$(ENVPROD) missing. Run: cp .env.prod.example $(ENVPROD) && edit it"; \
	  exit 1; }

deploy: check-env-prod ## Build + start the prod stack (migrations run on boot)
	$(PROD) up -d --build
	@$(PROD) ps

prod-build: check-env-prod ## Build prod images without starting
	$(PROD) build

prod-up: check-env-prod ## Start prod stack without rebuilding
	$(PROD) up -d

prod-down: check-env-prod ## Stop prod stack (volumes kept — data survives)
	$(PROD) down

prod-restart: check-env-prod ## Restart the backend container only
	$(PROD) restart backend

prod-logs: check-env-prod ## Tail prod backend logs
	$(PROD) logs -f backend

prod-ps: check-env-prod ## Prod stack status
	$(PROD) ps

prod-config: check-env-prod ## Render the resolved prod compose config
	$(PROD) config

prod-db-up: check-env-prod ## Deploy sqitch migrations to prod DB
	@. $(ENVPROD) && SQITCH_NETWORK=backend_internal \
		./sqitch deploy "db:pg://$$POSTGRES_USER:$$POSTGRES_PASSWORD@tijaru-postgres:5432/$$POSTGRES_DB"

prod-db-verify: check-env-prod ## Verify sqitch migrations on prod DB
	@. $(ENVPROD) && SQITCH_NETWORK=backend_internal \
		./sqitch verify "db:pg://$$POSTGRES_USER:$$POSTGRES_PASSWORD@tijaru-postgres:5432/$$POSTGRES_DB"

prod-db-status: check-env-prod ## Show sqitch migration status on prod
	@. $(ENVPROD) && SQITCH_NETWORK=backend_internal \
		./sqitch status "db:pg://$$POSTGRES_USER:$$POSTGRES_PASSWORD@tijaru-postgres:5432/$$POSTGRES_DB"

prod-migrate: check-env-prod ## Apply sqitch migrations to prod DB (alias for prod-db-up)
	@$(MAKE) prod-db-up

prod-psql: check-env-prod ## psql shell on the prod database
	$(PROD) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

prod-backup: check-env-prod ## Dump prod DB to backup-<utc-timestamp>.sql
	@f=backup-$$(date -u +%Y%m%d-%H%M%S).sql; \
	$(PROD) exec -T postgres sh -c 'pg_dump -U "$$POSTGRES_USER" "$$POSTGRES_DB"' > $$f; \
	echo "wrote $$f"

prod-dump-tenants: check-env-prod ## Dump prod businesses + users to tenants-backup.sql
	@$(PROD) exec -T postgres sh -c \
		'pg_dump -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" --data-only --no-owner --no-privileges \
		--table="app.businesses" --table="app_auth.users"' \
		> $(TENANT_DUMP) && echo "wrote $(TENANT_DUMP) ($$(wc -l < $(TENANT_DUMP)) lines)"

prod-load-tenants: check-env-prod ## Load tenants-backup.sql into prod DB
	@test -f $(TENANT_DUMP) || { echo "$(TENANT_DUMP) not found. Run: make prod-dump-tenants first"; exit 1; }
	@$(PROD) exec -T postgres sh -c \
		'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"' < $(TENANT_DUMP) \
		&& echo "loaded $(TENANT_DUMP) into prod DB"
