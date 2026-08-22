package com.iot.manager.repository;

import com.iot.manager.entity.OrganizationMembership;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrganizationMembershipRepository extends JpaRepository<OrganizationMembership, Long> {

    boolean existsByUserIdAndOrganizationId(Long userId, Long organizationId);
}
