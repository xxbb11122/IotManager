package com.iot.manager.repository;

import com.iot.manager.entity.DeviceConnection;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;

@Repository
public interface DeviceConnectionRepository extends JpaRepository<DeviceConnection, Long> {

    List<DeviceConnection> findByDeviceId(Long deviceId);

    List<DeviceConnection> findByAgentIdAndExternalId(String agentId, String externalId);

    void deleteByDeviceId(Long deviceId);

    @Query("select connection from DeviceConnection connection where connection.device.id in :deviceIds")
    List<DeviceConnection> findByDeviceIdIn(@Param("deviceIds") Collection<Long> deviceIds);
}
