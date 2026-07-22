# Playwright Chromium image for ProviderSoft download Lambda.
# Build context: repo root.
# Enable with: cdk deploy -c providerSoftLiveBot=true
#
# Default stack still uses the zip stub Lambda (no Docker required).

ARG PLAYWRIGHT_VERSION=1.49.1

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/providersoft-bot/package.json packages/providersoft-bot/
COPY tsconfig.base.json ./

RUN npm ci --workspace=@white-glove/shared --workspace=@white-glove/providersoft-bot \
  || npm install --workspace=@white-glove/shared --workspace=@white-glove/providersoft-bot

COPY packages/shared packages/shared
COPY packages/providersoft-bot packages/providersoft-bot

RUN npm run build -w @white-glove/shared \
  && npm run build -w @white-glove/providersoft-bot

# Runtime: same Playwright OS image + AWS Lambda RIC (Chromium deps already present)
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy

WORKDIR /var/task

RUN npm install -g aws-lambda-ric@3.1.1

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./node_modules/@white-glove/shared/package.json
COPY --from=build /app/packages/shared/dist ./node_modules/@white-glove/shared/dist
COPY --from=build /app/packages/providersoft-bot/package.json ./package.json
COPY --from=build /app/packages/providersoft-bot/dist ./dist

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_OPTIONS=--enable-source-maps
ENV HOME=/tmp
ENV XDG_CACHE_HOME=/tmp/.cache
ENV HEADLESS=true

ENTRYPOINT ["/usr/bin/npx", "aws-lambda-ric"]
CMD ["dist/handler.handler"]
