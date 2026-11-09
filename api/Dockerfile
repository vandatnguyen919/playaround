# API image: the resource server jar in Spring Boot layers.
# Build context: the repo root.
#   docker buildx build --platform linux/arm64,linux/amd64 -f api/Dockerfile -t <image> .
# Compiling happens once on the build platform; the final stage only copies
# onto the multi-arch JRE, so nothing compiles under QEMU.

FROM --platform=$BUILDPLATFORM eclipse-temurin:27-jdk AS jar
WORKDIR /src
# Build scripts first, so dependency downloads stay cached across code edits.
COPY gradlew settings.gradle build.gradle gradle.properties ./
COPY gradle/ gradle/
COPY gateway/build.gradle gateway/
COPY api/build.gradle api/
RUN --mount=type=cache,target=/root/.gradle \
    sed -i 's/\r$//' gradlew && chmod +x gradlew && ./gradlew --no-daemon -q :api:dependencies > /dev/null
COPY api/src/main api/src/main
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon -q :api:bootJar \
    && java -Djarmode=tools -jar api/build/libs/api-*.jar extract --layers --launcher --destination /layers

FROM eclipse-temurin:27-jre
WORKDIR /app
# Least to most often changed, one image layer each.
COPY --from=jar /layers/dependencies/ ./
COPY --from=jar /layers/spring-boot-loader/ ./
COPY --from=jar /layers/snapshot-dependencies/ ./
COPY --from=jar /layers/application/ ./
# Files stay root-owned and read-only to the process. No useradd: a RUN here
# would execute under QEMU for the foreign platform, and the JVM needs no name.
USER 10001:10001
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8182
# /actuator/health is public on the API port (SecurityConfig). No curl in the
# image, so a raw HTTP request over bash's /dev/tcp. Match the status code
# only: Tomcat sends no reason phrase ("HTTP/1.1 200 ").
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
    CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8182 && printf 'GET /actuator/health HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && grep -q '^HTTP/1.1 200 ' <&3"]
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
