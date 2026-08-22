package com.iot.manager.service;

import com.iot.manager.dto.CommandBatchView;
import com.iot.manager.entity.CommandBatch;
import com.iot.manager.entity.DeviceCommand;
import com.iot.manager.repository.CommandBatchRepository;
import com.iot.manager.repository.DeviceCommandRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class CommandBatchSummaryService {

    private final CommandBatchRepository batchRepository;
    private final DeviceCommandRepository commandRepository;
    private final WebSocketService webSocketService;

    @Transactional
    public CommandBatchView refresh(String batchId) {
        if (batchId == null || batchId.isBlank()) return null;
        CommandBatch batch = batchRepository.findByBatchId(batchId).orElse(null);
        if (batch == null) return null;
        List<DeviceCommand> commands = commandRepository.findByBatchIdOrderByRequestedAtAscIdAsc(batchId);
        int pending = count(commands, "PENDING");
        int sent = count(commands, "SENT");
        int acknowledged = count(commands, "ACKNOWLEDGED");
        int rejected = count(commands, "REJECTED");
        int failed = count(commands, "FAILED") + count(commands, "UNCONFIRMED");
        String nextStatus = status(commands.size(), pending, sent, acknowledged, rejected, failed);
        boolean changed = batch.getTotalCount() != commands.size()
                || batch.getPendingCount() != pending
                || batch.getSentCount() != sent
                || batch.getAcknowledgedCount() != acknowledged
                || batch.getRejectedCount() != rejected
                || batch.getFailedCount() != failed
                || !nextStatus.equals(batch.getStatus());
        batch.setTotalCount(commands.size());
        batch.setPendingCount(pending);
        batch.setSentCount(sent);
        batch.setAcknowledgedCount(acknowledged);
        batch.setRejectedCount(rejected);
        batch.setFailedCount(failed);
        batch.setStatus(nextStatus);
        if (isTerminal(nextStatus) && batch.getCompletedAt() == null) batch.setCompletedAt(LocalDateTime.now());
        CommandBatchView view = toView(batch);
        if (changed) webSocketService.broadcastEvent("command_batch_update", view);
        return view;
    }

    @Transactional(readOnly = true)
    public CommandBatchView get(String batchId) {
        return toView(batchRepository.findByBatchId(batchId)
                .orElseThrow(() -> new java.util.NoSuchElementException("Command batch not found")));
    }

    public CommandBatchView toView(CommandBatch batch) {
        return new CommandBatchView(
                batch.getBatchId(), batch.getSite().getId(), batch.getSite().getCode(),
                batch.getGroup() == null ? null : batch.getGroup().getPublicId(),
                batch.getTargetKind(), batch.getTargetLabel(), batch.getType(), batch.getStatus(),
                batch.getTotalCount(), batch.getPendingCount(), batch.getSentCount(), batch.getAcknowledgedCount(),
                batch.getFailedCount(), batch.getRejectedCount(), batch.getRequestedAt(), batch.getCompletedAt(), batch.getExpiresAt()
        );
    }

    private int count(List<DeviceCommand> commands, String status) {
        return (int) commands.stream().filter(command -> status.equals(command.getStatus())).count();
    }

    private String status(int total, int pending, int sent, int acknowledged, int rejected, int failed) {
        if (total == 0 || acknowledged + rejected + failed == total && acknowledged == 0) return "FAILED";
        if (pending > 0) return "QUEUED";
        if (sent > 0) return "RUNNING";
        if (acknowledged == total) return "SUCCEEDED";
        return acknowledged > 0 ? "PARTIALLY_SUCCEEDED" : "FAILED";
    }

    private boolean isTerminal(String status) {
        return "SUCCEEDED".equals(status) || "PARTIALLY_SUCCEEDED".equals(status) || "FAILED".equals(status);
    }
}
