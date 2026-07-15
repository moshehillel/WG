# Build TypeScript workspaces, then copy into the Node 20 Lambda image
# with Playwright Chromium available under PLAYWRIGHT_BROWSERS_PATH.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy AS build
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

FROM public.ecr.aws/lambda/nodejs:20

WORKDIR ${LAMBDA_TASK_ROOT}

COPY --from=build /ms-playwright /ms-playwright
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./node_modules/@white-glove/shared/package.json
COPY --from=build /app/packages/shared/dist ./node_modules/@white-glove/shared/dist
COPY --from=build /app/packages/providersoft-bot/package.json ./package.json
COPY --from=build /app/packages/providersoft-bot/dist ./dist

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_OPTIONS=--enable-source-maps

CMD ["dist/handler.handler"]
