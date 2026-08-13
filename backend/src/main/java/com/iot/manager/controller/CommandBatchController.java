package com.iot.manager.controller;

import com.iot.manager.dto.CommandBatchRequest;
import com.iot.manager.dto.CommandBatchView;
import com.iot.manager.dto.DeviceCommandView;
import com.iot.manager.service.CommandBatchService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/command-batches")
@RequiredArgsConstructor
public class CommandBatchController {

    private final CommandBatchService batchService;

    @PostMapping
    public CommandBatchView create(@Valid @RequestBody CommandBatchRequest request) {
        return batchService.create(request);
    }

    @GetMapping
    public List<CommandBatchView> list(@RequestParam(defaultValue = "demo-site") String siteCode) {
        return batchService.list(siteCode);
    }

    @GetMapping("/{batchId}")
    public CommandBatchView get(@PathVariable String batchId) {
        return batchService.get(batchId);
    }

    @GetMapping("/{batchId}/commands")
    public List<DeviceCommandView> commands(@PathVariable String batchId) {
        return batchService.commands(batchId);
    }
}
