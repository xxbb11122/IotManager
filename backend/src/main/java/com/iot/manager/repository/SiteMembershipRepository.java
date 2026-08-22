package com.iot.manager.repository;

import com.iot.manager.entity.SiteMembership;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SiteMembershipRepository extends JpaRepository<SiteMembership, Long> {

    boolean existsByUserIdAndSiteId(Long userId, Long siteId);
}
