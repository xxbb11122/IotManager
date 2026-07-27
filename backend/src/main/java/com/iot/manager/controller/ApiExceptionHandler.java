package com.iot.manager.controller;

import com.iot.manager.dto.ApiProblem;
import com.iot.manager.service.CommandValidationException;
import com.iot.manager.service.LanCandidateAlreadyClaimedException;
import jakarta.validation.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.NoSuchElementException;

@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(NoSuchElementException.class)
    public ResponseEntity<ApiProblem> handleNotFound(NoSuchElementException exception) {
        return problem(HttpStatus.NOT_FOUND, exception.getMessage(), Map.of());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiProblem> handleValidation(MethodArgumentNotValidException exception) {
        Map<String, String> fieldErrors = new LinkedHashMap<>();
        exception.getBindingResult().getFieldErrors().forEach(error ->
                fieldErrors.putIfAbsent(error.getField(), error.getDefaultMessage())
        );
        return problem(HttpStatus.BAD_REQUEST, "Request validation failed", fieldErrors);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiProblem> handleConstraintViolation(ConstraintViolationException exception) {
        Map<String, String> fieldErrors = new LinkedHashMap<>();
        exception.getConstraintViolations().forEach(violation ->
                fieldErrors.put(violation.getPropertyPath().toString(), violation.getMessage())
        );
        return problem(HttpStatus.BAD_REQUEST, "Request validation failed", fieldErrors);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiProblem> handleMalformedRequest(HttpMessageNotReadableException exception) {
        return problem(HttpStatus.BAD_REQUEST, "Malformed request body", Map.of());
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiProblem> handleTypeMismatch(MethodArgumentTypeMismatchException exception) {
        return problem(HttpStatus.BAD_REQUEST, "Invalid request parameter", Map.of());
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiProblem> handleConflict(DataIntegrityViolationException exception) {
        return problem(HttpStatus.CONFLICT, "The request conflicts with an existing resource", Map.of());
    }

    @ExceptionHandler(LanCandidateAlreadyClaimedException.class)
    public ResponseEntity<ApiProblem> handleCandidateClaimConflict(LanCandidateAlreadyClaimedException exception) {
        return problem(HttpStatus.CONFLICT, exception.getMessage(), Map.of());
    }

    @ExceptionHandler(CommandValidationException.class)
    public ResponseEntity<ApiProblem> handleCommandValidation(CommandValidationException exception) {
        return problem(HttpStatus.BAD_REQUEST, exception.getMessage(), exception.getFieldErrors());
    }

    private ResponseEntity<ApiProblem> problem(HttpStatus status, String message, Map<String, String> fieldErrors) {
        ApiProblem body = new ApiProblem(
                Instant.now(),
                status.value(),
                status.getReasonPhrase(),
                message,
                fieldErrors
        );
        return ResponseEntity.status(status).body(body);
    }
}
