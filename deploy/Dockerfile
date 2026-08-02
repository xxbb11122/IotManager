# Multi-stage build for the IoT Manager backend.
# Build stage uses JDK 17 + Maven from Maven Central; runtime stage is a slim JRE.
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY backend/pom.xml .
RUN mvn -q dependency:go-offline
COPY backend/src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /src/target/iot-manager-1.0.0.jar /app/iot-manager.jar
EXPOSE 8080
VOLUME /app/data
ENTRYPOINT ["java", "-jar", "/app/iot-manager.jar"]
