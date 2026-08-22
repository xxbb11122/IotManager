package com.iot.manager.repository;

import com.iot.manager.entity.Organization;
import com.iot.manager.entity.Site;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.List;

@Repository
public interface SiteRepository extends JpaRepository<Site, Long> {

    Optional<Site> findByOrganizationAndCode(Organization organization, String code);

    Optional<Site> findFirstByCode(String code);

    List<Site> findAllByCode(String code);
}
