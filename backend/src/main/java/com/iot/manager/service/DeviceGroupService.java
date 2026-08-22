package com.iot.manager.service;

import com.iot.manager.dto.DeviceGroupCreateRequest;
import com.iot.manager.dto.DeviceGroupMembersRequest;
import com.iot.manager.dto.DeviceGroupUpdateRequest;
import com.iot.manager.dto.DeviceGroupView;
import com.iot.manager.entity.Device;
import com.iot.manager.entity.DeviceGroup;
import com.iot.manager.entity.DeviceGroupMember;
import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import com.iot.manager.repository.DeviceGroupMemberRepository;
import com.iot.manager.repository.DeviceGroupRepository;
import com.iot.manager.repository.DeviceRepository;
import com.iot.manager.repository.OrganizationRepository;
import com.iot.manager.repository.SiteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class DeviceGroupService {

    private static final String DEMO_ORGANIZATION_CODE = "demo-org";
    private static final String DEFAULT_SITE_CODE = "demo-site";

    private final DeviceGroupRepository groupRepository;
    private final DeviceGroupMemberRepository memberRepository;
    private final DeviceRepository deviceRepository;
    private final OrganizationRepository organizationRepository;
    private final SiteRepository siteRepository;
    private final BootstrapService bootstrapService;
    private final AuditEventService auditEventService;
    private final WebSocketService webSocketService;
    private final SiteAccessService siteAccessService;

    @Transactional(readOnly = true)
    public List<DeviceGroupView> list(String siteCode) {
        return groupRepository.findBySiteCodeAndArchivedAtIsNullOrderByNameAsc(normalizeSiteCode(siteCode)).stream()
                .map(this::toView)
                .toList();
    }

    @Transactional(readOnly = true)
    public DeviceGroupView get(String groupId) {
        return toView(requireActive(groupId));
    }

    @Transactional
    public DeviceGroupView create(DeviceGroupCreateRequest request) {
        Site site = resolveSite(request.siteCode());
        LocalDateTime now = LocalDateTime.now();
        DeviceGroup group = groupRepository.save(DeviceGroup.builder()
                .publicId("group-" + UUID.randomUUID())
                .site(site)
                .name(request.name().trim())
                .description(blankToNull(request.description()))
                .version(0L)
                .createdAt(now)
                .updatedAt(now)
                .build());
        DeviceGroupView view = toView(group);
        webSocketService.broadcastEvent("device_group_update", view);
        return view;
    }

    @Transactional
    public DeviceGroupView update(String groupId, DeviceGroupUpdateRequest request) {
        DeviceGroup group = requireActiveForUpdate(groupId);
        assertVersion(group, request.expectedVersion());
        if (request.name() != null) group.setName(request.name().trim());
        if (request.description() != null) group.setDescription(blankToNull(request.description()));
        touch(group);
        DeviceGroupView view = toView(group);
        webSocketService.broadcastEvent("device_group_update", view);
        return view;
    }

    @Transactional
    public DeviceGroupView changeMembers(String groupId, DeviceGroupMembersRequest request) {
        DeviceGroup group = requireActiveForUpdate(groupId);
        assertVersion(group, request.expectedVersion());
        Set<Long> addIds = ids(request.addDeviceIds());
        Set<Long> removeIds = ids(request.removeDeviceIds());
        addIds.removeAll(removeIds);

        if (!addIds.isEmpty()) {
            List<Device> devices = deviceRepository.findAllById(addIds);
            if (devices.size() != addIds.size()) throw new NoSuchElementException("Device not found");
            for (Device device : devices) {
                if (device.getArchivedAt() != null) throw new IllegalArgumentException("Archived devices cannot join a group");
                if (device.getSite() == null || !group.getSite().getId().equals(device.getSite().getId())) {
                    throw new IllegalArgumentException("All group members must belong to the same site");
                }
            }
            Set<Long> existing = memberRepository.findByGroupIdAndDeviceIdIn(group.getId(), addIds).stream()
                    .map(member -> member.getDevice().getId())
                    .collect(java.util.stream.Collectors.toSet());
            LocalDateTime now = LocalDateTime.now();
            devices.stream()
                    .filter(device -> !existing.contains(device.getId()))
                    .forEach(device -> {
                        memberRepository.save(DeviceGroupMember.builder()
                                .group(group)
                                .device(device)
                                .addedAt(now)
                                .build());
                        saveActivity(device, "GROUP_MEMBERSHIP_ADDED", group.getPublicId());
                    });
        }
        if (!removeIds.isEmpty()) {
            memberRepository.findByGroupIdAndDeviceIdIn(group.getId(), removeIds).forEach(member ->
                    saveActivity(member.getDevice(), "GROUP_MEMBERSHIP_REMOVED", group.getPublicId())
            );
            memberRepository.deleteByGroupIdAndDeviceIdIn(group.getId(), removeIds);
        }
        touch(group);
        DeviceGroupView view = toView(group);
        webSocketService.broadcastEvent("device_group_update", view);
        return view;
    }

    @Transactional
    public DeviceGroupView archive(String groupId) {
        DeviceGroup group = requireActiveForUpdate(groupId);
        group.setArchivedAt(LocalDateTime.now());
        touch(group);
        DeviceGroupView view = toView(group);
        webSocketService.broadcastEvent("device_group_update", view);
        return view;
    }

    @Transactional(readOnly = true)
    public List<Device> activeMembers(String groupId) {
        DeviceGroup group = requireActive(groupId);
        return memberRepository.findByGroupIdOrderByAddedAtAsc(group.getId()).stream()
                .map(DeviceGroupMember::getDevice)
                .filter(device -> device.getArchivedAt() == null)
                .toList();
    }

    private DeviceGroup requireActive(String groupId) {
        return groupRepository.findByPublicId(groupId)
                .filter(group -> group.getArchivedAt() == null)
                .orElseThrow(() -> new NoSuchElementException("Device group not found"));
    }

    private DeviceGroup requireActiveForUpdate(String groupId) {
        return groupRepository.findByPublicIdForUpdate(groupId)
                .filter(group -> group.getArchivedAt() == null)
                .orElseThrow(() -> new NoSuchElementException("Device group not found"));
    }

    private Site resolveSite(String siteCode) {
        if (siteAccessService.isScopeEnforced()) {
            return siteAccessService.requireSiteAccess(siteCode);
        }
        bootstrapService.ensureDemoContext();
        Organization organization = organizationRepository.findByCode(DEMO_ORGANIZATION_CODE)
                .orElseThrow(() -> new NoSuchElementException("Organization not found"));
        return siteRepository.findByOrganizationAndCode(organization, normalizeSiteCode(siteCode))
                .orElseThrow(() -> new NoSuchElementException("Site not found"));
    }

    private DeviceGroupView toView(DeviceGroup group) {
        List<DeviceGroupMember> members = memberRepository.findByGroupIdOrderByAddedAtAsc(group.getId());
        int memberCount = (int) members.stream().filter(member -> member.getDevice().getArchivedAt() == null).count();
        int onlineCount = (int) members.stream().map(DeviceGroupMember::getDevice)
                .filter(device -> device.getArchivedAt() == null && "ONLINE".equals(device.getStatus()))
                .count();
        return new DeviceGroupView(
                group.getPublicId(), group.getSite().getId(), group.getSite().getCode(), group.getName(), group.getDescription(),
                group.getVersion(), memberCount, onlineCount, group.getUpdatedAt(), group.getArchivedAt()
        );
    }

    private void touch(DeviceGroup group) {
        group.setVersion(group.getVersion() + 1);
        group.setUpdatedAt(LocalDateTime.now());
    }

    private void assertVersion(DeviceGroup group, Long expectedVersion) {
        if (!group.getVersion().equals(expectedVersion)) {
            throw new GroupVersionConflictException("Device group has changed; refresh and retry");
        }
    }

    private Set<Long> ids(Collection<Long> values) {
        if (values == null) return new HashSet<>();
        Set<Long> result = new HashSet<>();
        for (Long value : values) if (value != null) result.add(value);
        return result;
    }

    private void saveActivity(Device device, String eventType, String groupId) {
        auditEventService.recordActivity(
                device,
                eventType,
                "Device group membership changed",
                "{\"groupId\":\"" + groupId + "\"}"
        );
    }

    private String normalizeSiteCode(String siteCode) {
        return siteCode == null || siteCode.isBlank() ? DEFAULT_SITE_CODE : siteCode.trim();
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
