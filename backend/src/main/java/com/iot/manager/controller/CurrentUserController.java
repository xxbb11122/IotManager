package com.iot.manager.controller;

import com.iot.manager.dto.CurrentUserView;
import com.iot.manager.service.SiteAccessService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Versioned identity bootstrap endpoint for web and mobile clients. */
@RestController
@RequestMapping({"/api/me", "/api/v1/me"})
@RequiredArgsConstructor
public class CurrentUserController {

    private final SiteAccessService siteAccessService;

    @GetMapping
    public CurrentUserView currentUser() {
        return siteAccessService.currentUserView();
    }
}
