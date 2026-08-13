package com.iot.manager.controller;

import com.iot.manager.dto.ApiProblem;
import com.iot.manager.service.LanCandidateAlreadyClaimedException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ApiExceptionHandlerTest {

    @Test
    void onlyCandidateClaimConflictIsMappedToConflict() {
        ApiExceptionHandler handler = new ApiExceptionHandler();

        ResponseEntity<ApiProblem> response = handler.handleCandidateClaimConflict(
                new LanCandidateAlreadyClaimedException("lan-demo-sensor-01")
        );
        List<Class<? extends Throwable>> handledTypes = Arrays.stream(ApiExceptionHandler.class.getDeclaredMethods())
                .filter(method -> method.isAnnotationPresent(ExceptionHandler.class))
                .flatMap(method -> Arrays.stream(method.getAnnotation(ExceptionHandler.class).value()))
                .toList();

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo(HttpStatus.CONFLICT.value());
        assertThat(handledTypes)
                .contains(LanCandidateAlreadyClaimedException.class)
                .doesNotContain(IllegalStateException.class);
    }
}
