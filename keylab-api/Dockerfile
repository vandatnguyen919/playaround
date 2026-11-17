# keylab-api image: the KeyLab Spring Modulith jar in Spring Boot layers.
# Build context: the repo root. Same pattern as api/Dockerfile.
#   docker buildx build --platform linux/arm64,linux/amd64 -f keylab-api/Dockerfile -t <image> .
# Compiling happens once on the build platform; the final stage only copies
# onto the multi-arch JRE, so nothing compiles under QEMU.

FROM --platform=$BUILDPLATFORM eclipse-temurin:26-jdk AS jar
WORKDIR /src
# Build scripts first, so dependency downloads stay cached across code edits.
COPY gradlew settings.gradle build.gradle gradle.properties ./
COPY gradle/ gradle/
# settings.gradle includes all three, and Gradle fails on a project with no directory.
COPY gateway/build.gradle gateway/
COPY api/build.gradle api/
COPY keylab-api/build.gradle keylab-api/
RUN --mount=type=cache,target=/root/.gradle \
    sed -i 's/\r$//' gradlew && chmod +x gradlew && ./gradlew --no-daemon -q :keylab-api:dependencies > /dev/null
COPY keylab-api/src/main keylab-api/src/main
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon -q :keylab-api:bootJar \
    && java -Djarmode=tools -jar keylab-api/build/libs/keylab-api-*.jar extract --layers --launcher --destination /layers \
    && mkdir /storage

FROM eclipse-temurin:26-jre
WORKDIR /app
# Least to most often changed, one image layer each.
COPY --from=jar /layers/dependencies/ ./
COPY --from=jar /layers/spring-boot-loader/ ./
COPY --from=jar /layers/snapshot-dependencies/ ./
COPY --from=jar /layers/application/ ./
# Uploads, recordings and photos (KEYLAB_STORAGE_DIR). Owned by the process user, so a
# named volume mounted here starts writable. COPY, not RUN: no QEMU for the other platform.
COPY --from=jar --chown=10001:10001 /storage /data/keylab-storage
# Files stay root-owned and read-only to the process. No useradd: a RUN here
# would execute under QEMU for the foreign platform, and the JVM needs no name.
USER 10001:10001
ENV KEYLAB_STORAGE_DIR=/data/keylab-storage
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8183
# /actuator/health is public on the API port (shared/security/SecurityConfig). No curl
# in the image, so a raw HTTP request over bash's /dev/tcp. Match the status code only:
# Tomcat sends no reason phrase ("HTTP/1.1 200 "). Start period covers Flyway on 2 vCPUs.
HEALTHCHECK --interval=10s --timeout=5s --start-period=90s --retries=6 \
    CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8183 && printf 'GET /actuator/health HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && grep -q '^HTTP/1.1 200 ' <&3"]
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
