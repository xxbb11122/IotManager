package com.iot.manager.repository;

import com.iot.manager.entity.DeviceGroupMember;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface DeviceGroupMemberRepository extends JpaRepository<DeviceGroupMember, Long> {

    List<DeviceGroupMember> findByGroupIdOrderByAddedAtAsc(Long groupId);

    List<DeviceGroupMember> findByGroupIdAndDeviceIdIn(Long groupId, Collection<Long> deviceIds);

    void deleteByGroupIdAndDeviceIdIn(Long groupId, Collection<Long> deviceIds);
}
