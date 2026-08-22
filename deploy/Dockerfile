# Spring Boot platform image. Static web applications are built separately by
# deploy/Caddy.Dockerfile and never share the backend runtime filesystem.
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY backend/pom.xml .
RUN mvn -q dependency:go-offline
COPY backend/src ./src
COPY profiles /profiles
RUN mvn -q package -DskipTests

FROM eclipse-temurin:17-jre
RUN groupadd --system --gid 10001 iot && useradd --system --uid 10001 --gid iot --create-home iot
WORKDIR /app
COPY --from=build --chown=iot:iot /src/target/iot-manager-1.0.0.jar /app/iot-manager.jar
USER iot
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/iot-manager.jar"]
