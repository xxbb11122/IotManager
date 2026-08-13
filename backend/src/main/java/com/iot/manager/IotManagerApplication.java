package com.iot.manager;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class IotManagerApplication {
    public static void main(String[] args) {
        SpringApplication.run(IotManagerApplication.class, args);
    }
}
