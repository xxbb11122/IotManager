# Backend image for the IoT Manager platform. The static monitoring and
# console applications are built by deploy/Caddy.Dockerfile.
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY backend/pom.xml .
RUN mvn -q dependency:go-offline
COPY backend/src ./src
# Backend profiles are packaged as classpath resources by backend/pom.xml.
COPY profiles /profiles
RUN mvn -q package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /src/target/iot-manager-1.0.0.jar /app/iot-manager.jar
EXPOSE 8080
VOLUME /app/data
ENTRYPOINT ["java", "-jar", "/app/iot-manager.jar"]
