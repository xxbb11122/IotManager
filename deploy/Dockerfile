# Spring Boot platform image. Static web applications are built separately by
# deploy/Caddy.Dockerfile and never share the backend runtime filesystem.
FROM maven:3.9-eclipse-temurin-17@sha256:a8746f15d5bb26b5b8bacb056cc76211553850f4c71d16aff845cfa004cbc197 AS build
WORKDIR /src
COPY backend/pom.xml .
# CI and the runtime verification scripts may set this value to force a
# source rebuild while retaining the BuildKit Maven dependency cache.
ARG BACKEND_SOURCE_REVISION=local
RUN test -n "$BACKEND_SOURCE_REVISION"
COPY backend/src ./src
COPY profiles /profiles
RUN --mount=type=cache,id=iot-manager-maven-repository,target=/root/.m2/repository \
    attempt=1; \
    until [ "$attempt" -gt 3 ]; do \
      mvn -B -Dmaven.wagon.http.retryHandler.count=5 package -DskipTests && exit 0; \
      [ "$attempt" -eq 3 ] && exit 1; \
      find /root/.m2/repository -name '*.lastUpdated' -delete; \
      attempt=$((attempt + 1)); \
      sleep 3; \
    done

FROM eclipse-temurin:17-jre-jammy@sha256:e17d77fb030dd4b642dc078d048a5fb9efcb3676ee20305d905949105a6ccd5a
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 iot \
    && useradd --system --uid 10001 --gid iot --create-home iot
WORKDIR /app
COPY --from=build --chown=iot:iot /src/target/iot-manager-1.0.0.jar /app/iot-manager.jar
USER iot
EXPOSE 8080
ENTRYPOINT ["java", "-Djava.io.tmpdir=/tmp", "-jar", "/app/iot-manager.jar"]
