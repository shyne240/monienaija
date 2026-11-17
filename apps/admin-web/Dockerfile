# MonieNaija admin web — static production build behind nginx.
#
# The application already decides how its API base URL resolves (src/config/build-config.ts), and for
# a static build that rule is: an unset `ADMIN_WEB_API_BASE_URL` resolves to `''` and `ApiClient` fails
# closed, while a loopback/localhost value is rejected outright. There is no production default that
# silently points at a developer machine. This Dockerfile therefore supplies the same-origin relative
# path explicitly, because that is a deliberate decision for a proxied deployment and not something to
# leave to a default. The build below additionally greps the emitted bundle for loopback endpoints and
# fails if any appear, so the application-level rule is verified against the artefact rather than
# trusted.

# ---------------------------------------------------------------- build
FROM node:22.22.3-alpine3.20 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Same-origin relative path. An absolute URL may be supplied for a split-origin deployment, but it
# must be given explicitly at build time and must not be a loopback address — the application rejects
# that, and the artefact check below would catch it too.
ARG ADMIN_WEB_API_BASE_URL=/api/v1
ENV ADMIN_WEB_API_BASE_URL=${ADMIN_WEB_API_BASE_URL}

RUN npm run build

# Fail the build if the bundle hardcodes a loopback or test endpoint. A production artefact that calls
# 127.0.0.1 is a broken artefact, and catching it here is far cheaper than catching it in a browser.
RUN set -eu; \
    if grep -rIlE 'https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)([:/]|$)' dist/assets > /dev/null 2>&1; then \
      echo "ERROR: built bundle references a loopback API endpoint" >&2; \
      grep -rIlE 'https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)([:/]|$)' dist/assets >&2; \
      exit 1; \
    fi; \
    echo "bundle endpoint check passed"

# ---------------------------------------------------------------- runtime
FROM nginx:1.27-alpine AS runtime

# The stock nginx config serves on 80 as root and writes to directories this image makes read-only.
# This config listens on 8080 as the unprivileged nginx user, so the container needs no capabilities.
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

RUN chown -R nginx:nginx /usr/share/nginx/html \
 && mkdir -p /var/cache/nginx /var/run \
 && chown -R nginx:nginx /var/cache/nginx /var/run

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "--spider", "-q", "http://127.0.0.1:8080/"]

STOPSIGNAL SIGQUIT
