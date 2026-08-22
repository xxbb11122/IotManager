package com.iot.manager.dto;

import java.util.List;

/** Authenticated platform identity and the site contexts it may select. */
public record CurrentUserView(
        Long id,
        String subject,
        String username,
        String displayName,
        String email,
        List<String> roles,
        List<SiteView> sites
) {
    public CurrentUserView {
        roles = roles == null ? List.of() : List.copyOf(roles);
        sites = sites == null ? List.of() : List.copyOf(sites);
    }
}
