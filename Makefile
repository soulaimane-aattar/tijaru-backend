# Tijaru backend — dev + production docker stacks.
#   make help        list targets
#   make up          dev stack   (docker-compose.yml,      ports 3002 / 5433)
#   make deploy      prod stack  (docker-compose.prod.yml, no host ports)

DEV     := docker compose -f docker-compose.yml
PROD    := docker compose -f docker-compose.prod.yml --env-file .env.prod
ENVPROD := .env.prod

.DEFAULT_GOAL := help
.PHONY: help up down logs ps seed dev-migrate \
        deploy prod-build prod-up prod-down prod-restart prod-logs prod-ps \
        prod-migrate prod-psql prod-backup prod-config check-env-prod

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

prod-migrate: check-env-prod ## Apply pending migrations in the prod container
	$(PROD) exec backend npx prisma migrate deploy

prod-psql: check-env-prod ## psql shell on the prod database
	$(PROD) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

prod-backup: check-env-prod ## Dump prod DB to backup-<utc-timestamp>.sql
	@f=backup-$$(date -u +%Y%m%d-%H%M%S).sql; \
	$(PROD) exec -T postgres sh -c 'pg_dump -U "$$POSTGRES_USER" "$$POSTGRES_DB"' > $$f; \
	echo "wrote $$f"
