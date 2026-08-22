package com.iot.manager.repository;

import com.iot.manager.entity.WeatherProviderAccessEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WeatherProviderAccessEventRepository extends JpaRepository<WeatherProviderAccessEvent, Long> {
}
