# Renvara BETA web app as one container. Build from the repository root:
#
#   docker build -f apps/beta-web/Dockerfile -t renvara-beta .
#
# Records and offer PDFs live in /data (mount a volume there). Accounts, keys
# and addresses come from the environment at run time (deploy/README.md),
# never from the image. RENVARA_EDITION=clean (default) starts empty for real
# use; RENVARA_EDITION=demo starts with the presentation demo records.
ARG NODE_IMAGE=node:22.23.3-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN npm install --global --no-fund --no-audit pnpm@10.28.0
# Manifests first: dependencies are reinstalled only when they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/beta-web/package.json apps/beta-web/
COPY packages/domain/package.json packages/domain/
COPY packages/database/package.json packages/database/
RUN pnpm install --frozen-lockfile --prod --filter @renvara/beta-web...
# What the server reads at run time.
COPY packages/domain/src packages/domain/src
COPY apps/beta-web/src apps/beta-web/src
COPY apps/beta-web/public apps/beta-web/public
COPY prototypes/home prototypes/home
ARG RENVARA_EDITION=clean
RUN case "$RENVARA_EDITION" in \
      clean) printf '%s\n' '// Built by apps/beta-web/Dockerfile (RENVARA_EDITION=clean).' \
               'export const DEMO_CONTENT = false;' > apps/beta-web/public/app/js/core/edition.js ;; \
      demo) ;; \
      *) echo "RENVARA_EDITION must be clean or demo" >&2; exit 1 ;; \
    esac

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    RENVARA_DATA_FILE=/data/crm.json \
    RENVARA_DOCUMENTS_DIR=/data/offer-documents
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/login').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/beta-web/src/server.ts"]
