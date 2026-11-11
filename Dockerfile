# LeadScout — single-container Node app (no build step, no dependencies)
FROM node:22-alpine

WORKDIR /app

# Only source is needed; there is no npm install step.
COPY package.json ./
COPY LeadScout ./LeadScout

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0

EXPOSE 8787

# Basic auth is enabled by setting APP_PASSWORD at runtime.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "LeadScout/server.mjs"]
