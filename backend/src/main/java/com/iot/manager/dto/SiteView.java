package com.iot.manager.dto;

/** A selectable site context returned to authenticated web and mobile clients. */
public record SiteView(
        Long id,
        String organizationCode,
        String organizationName,
        String siteCode,
        String siteName
) {
}
