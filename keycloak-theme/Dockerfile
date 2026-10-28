# Production Keycloak image: Postgres, health and metrics, and the Keycloakify
# theme baked in with `kc.sh build`, so `start --optimized` skips the Quarkus
# build on every start. Build context: this directory.
#   docker buildx build --platform linux/arm64,linux/amd64 -t <image> keycloak-theme

# The theme jar is plain files, so build it once on the build platform.
FROM --platform=$BUILDPLATFORM node:22.20.0-alpine AS theme
# keycloakify build packages the jar with Maven (which pulls in a JDK).
RUN apk add --no-cache maven
WORKDIR /src
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --fetch-retries=5
COPY . .
RUN npm run build-keycloak-theme

FROM quay.io/keycloak/keycloak:26.8.1 AS builder
# Build-time options. Changing any of these needs a rebuild.
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true
COPY --from=theme /src/dist_keycloak/keycloak-theme-for-kc-all-other-versions.jar /opt/keycloak/providers/keycloak-theme.jar
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.8.1
COPY --from=builder /opt/keycloak/ /opt/keycloak/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized"]
