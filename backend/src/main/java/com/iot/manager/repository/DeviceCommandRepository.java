package com.iot.manager.repository;

import com.iot.manager.entity.DeviceCommand;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.time.Instant;
import org.springframework.data.domain.Pageable;

@Repository
public interface DeviceCommandRepository extends JpaRepository<DeviceCommand, Long>, JpaSpecificationExecutor<DeviceCommand> {

    Optional<DeviceCommand> findByCommandId(String commandId);

    @Query("select command.device.id from DeviceCommand command where command.commandId = :commandId")
    Optional<Long> findDeviceIdByCommandId(@Param("commandId") String commandId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select command from DeviceCommand command where command.commandId = :commandId")
    Optional<DeviceCommand> findByCommandIdForUpdate(@Param("commandId") String commandId);

    Optional<DeviceCommand> findByDeviceIdAndIdempotencyKey(Long deviceId, String idempotencyKey);

    List<DeviceCommand> findByDeviceIdOrderByRequestedAtDesc(Long deviceId);

    List<DeviceCommand> findByBatchIdOrderByRequestedAtAscIdAsc(String batchId);

    List<DeviceCommand> findByBatchIdAndStatus(String batchId, String status);

    void deleteByDeviceId(Long deviceId);

    List<DeviceCommand> findByStatus(String status);

    List<DeviceCommand> findByStatusAndSource(String status, String source);

    @Query("""
            select command.commandId
            from DeviceCommand command
            where command.status = 'PENDING' and command.source <> 'EDGE_AGENT'
            order by command.requestedAt asc, command.id asc
            """)
    List<String> findPendingCommandIdsOrderByRequestedAtAscIdAsc();

    @Query("""
            select command from DeviceCommand command
            where command.completedAtUtc < :cutoff
              and command.status in ('ACKNOWLEDGED', 'FAILED', 'UNCONFIRMED', 'REJECTED')
              and not exists (select event.id from CommandEvent event where event.command = command)
            order by command.completedAtUtc asc
            """)
    List<DeviceCommand> findRetainableBefore(@Param("cutoff") Instant cutoff, Pageable pageable);

    @Query("""
            select command from DeviceCommand command
            where command.completedAtUtc < :cutoff
              and command.status in ('ACKNOWLEDGED', 'FAILED', 'UNCONFIRMED', 'REJECTED')
              and not exists (select event.id from CommandEvent event where event.command = command)
              and (command.completedAtUtc > :cursorAt
                   or (command.completedAtUtc = :cursorAt and command.id > :cursorId))
            order by command.completedAtUtc asc, command.id asc
            """)
    List<DeviceCommand> findRetentionCandidatesAfter(
            @Param("cutoff") Instant cutoff,
            @Param("cursorAt") Instant cursorAt,
            @Param("cursorId") Long cursorId,
            Pageable pageable
    );
}
