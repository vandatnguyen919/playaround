# Gateway image: the BFF jar in Spring Boot layers, with the built SPA
# (web/dist) next to it, served by the gateway so the HTML carries the CSP.
# Build context: the repo root.
#   docker buildx build --platform linux/arm64,linux/amd64 -f gateway/Dockerfile -t <image> .
# Compiling happens once on the build platform; the final stage only copies
# onto the multi-arch JRE, so nothing compiles under QEMU.

FROM --platform=$BUILDPLATFORM node:22.20.0-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --fetch-retries=5
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM eclipse-temurin:27-jdk AS jar
WORKDIR /src
# Build scripts first, so dependency downloads stay cached across code edits.
COPY gradlew settings.gradle build.gradle gradle.properties ./
COPY gradle/ gradle/
COPY gateway/build.gradle gateway/
COPY api/build.gradle api/
RUN --mount=type=cache,target=/root/.gradle \
    sed -i 's/\r$//' gradlew && chmod +x gradlew && ./gradlew --no-daemon -q :gateway:dependencies > /dev/null
COPY gateway/src/main gateway/src/main
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon -q :gateway:bootJar \
    && java -Djarmode=tools -jar gateway/build/libs/gateway-*.jar extract --layers --launcher --destination /layers

FROM eclipse-temurin:27-jre
WORKDIR /app
# Least to most often changed, one image layer each.
COPY --from=jar /layers/dependencies/ ./
COPY --from=jar /layers/spring-boot-loader/ ./
COPY --from=jar /layers/snapshot-dependencies/ ./
COPY --from=jar /layers/application/ ./
COPY --from=web /src/web/dist/ /app/web/dist/
# Files stay root-owned and read-only to the process. No useradd: a RUN here
# would execute under QEMU for the foreign platform, and the JVM needs no name.
USER 10001:10001
ENV SPA_LOCATION=file:/app/web/dist/ \
    MANAGEMENT_ADDRESS=0.0.0.0 \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError --enable-native-access=ALL-UNNAMED"
EXPOSE 8181 9181
# Readiness on the management port (never published). No curl in the image,
# so a raw HTTP request over bash's /dev/tcp.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
    CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/${MANAGEMENT_PORT:-9181} && printf 'GET /actuator/health/readiness HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && grep -q '^HTTP/1.1 200 ' <&3"]
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
