package com.iot.manager.controller;

import com.iot.manager.dto.SiteView;
import com.iot.manager.service.SiteAccessService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Versioned context endpoint used by the R1 minimal site switcher. */
@RestController
@RequestMapping("/api/v1/sites")
@RequiredArgsConstructor
public class SiteController {

    private final SiteAccessService siteAccessService;

    @GetMapping
    public List<SiteView> listAccessibleSites() {
        return siteAccessService.accessibleSiteViews();
    }
}
