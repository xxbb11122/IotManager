package com.iot.manager.service;

import com.iot.manager.dto.AlertView;
import com.iot.manager.dto.PageResponse;
import com.iot.manager.entity.Alert;
import com.iot.manager.entity.DeviceGroupMember;
import com.iot.manager.repository.AlertRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class AlertService {

    private final AlertRepository alertRepository;

    @Transactional(readOnly = true)
    public PageResponse<AlertView> search(
            Boolean resolved, List<String> levels, String groupId, Long deviceId,
            LocalDateTime from, LocalDateTime to, String query, int page, int size
    ) {
        Specification<Alert> specification = Specification.where(null);
        if (resolved != null) specification = specification.and((root, criteriaQuery, builder) -> builder.equal(root.get("resolved"), resolved));
        if (levels != null && !levels.isEmpty()) specification = specification.and((root, criteriaQuery, builder) -> root.get("level").in(levels));
        if (deviceId != null) specification = specification.and((root, criteriaQuery, builder) -> builder.equal(root.get("device").get("id"), deviceId));
        if (groupId != null && !groupId.isBlank()) {
            specification = specification.and((root, criteriaQuery, builder) -> {
                jakarta.persistence.criteria.Subquery<Long> memberDevices = criteriaQuery.subquery(Long.class);
                jakarta.persistence.criteria.Root<DeviceGroupMember> members = memberDevices.from(DeviceGroupMember.class);
                memberDevices.select(members.get("device").get("id"));
                memberDevices.where(builder.equal(members.get("group").get("publicId"), groupId.trim()));
                return root.get("device").get("id").in(memberDevices);
            });
        }
        if (from != null) specification = specification.and((root, criteriaQuery, builder) -> builder.greaterThanOrEqualTo(root.get("createdAt"), from));
        if (to != null) specification = specification.and((root, criteriaQuery, builder) -> builder.lessThanOrEqualTo(root.get("createdAt"), to));
        if (query != null && !query.isBlank()) specification = specification.and((root, criteriaQuery, builder) ->
                builder.like(builder.lower(root.get("message")), "%" + query.trim().toLowerCase() + "%")
        );
        int normalizedPage = Math.max(0, page);
        int normalizedSize = Math.min(100, Math.max(1, size));
        return PageResponse.from(
                alertRepository.findAll(specification, PageRequest.of(
                        normalizedPage, normalizedSize, Sort.by(Sort.Direction.DESC, "createdAt", "id")
                )),
                this::toView
        );
    }

    /**
     * The legacy dashboard endpoints must never expose JPA entities directly:
     * Alert.device is lazy and Jackson would otherwise traverse Hibernate
     * proxies once a device belongs to an organization/site hierarchy.
     */
    @Transactional(readOnly = true)
    public List<AlertView> active() {
        return alertRepository.findByResolvedFalseOrderByCreatedAtDesc().stream()
                .map(this::toView)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<AlertView> recent() {
        return alertRepository.findTop20ByOrderByCreatedAtDesc().stream()
                .map(this::toView)
                .toList();
    }

    @Transactional(readOnly = true)
    public AlertView getView(Long id) {
        return alertRepository.findById(id)
                .map(this::toView)
                .orElseThrow(() -> new java.util.NoSuchElementException("Alert not found"));
    }

    private AlertView toView(Alert alert) {
        return new AlertView(
                alert.getId(),
                alert.getDevice() == null ? null : alert.getDevice().getId(),
                alert.getDevice() == null ? null : alert.getDevice().getName(),
                alert.getDevice() == null ? null : alert.getDevice().getPublicId(),
                alert.getLevel(), alert.getStatus(), alert.getAlertCode(), alert.getMessage(), alert.getCreatedAt(),
                alert.getAcknowledgedAt(), alert.getResolvedAt()
        );
    }
}
