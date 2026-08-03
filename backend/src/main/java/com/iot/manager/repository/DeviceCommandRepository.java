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
}
