package com.iot.manager.repository;

import com.iot.manager.entity.Site;
import com.iot.manager.entity.Space;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface SpaceRepository extends JpaRepository<Space, Long> {

    Optional<Space> findBySiteAndPath(Site site, String path);

    Optional<Space> findFirstBySiteIdOrderById(Long siteId);
}
