package com.iot.manager.service;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@ConditionalOnProperty(name = "iot.command-simulator.enabled", havingValue = "true", matchIfMissing = false)
public class CommandSimulator {

    private final CommandService commandService;

    @Scheduled(
            fixedDelayString = "${iot.command-simulator.interval-ms:1000}",
            initialDelayString = "${iot.command-simulator.initial-delay-ms:5000}"
    )
    public void tick() {
        commandService.processPending();
    }
}
