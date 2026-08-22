package com.iot.manager.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * One-time production ownership mapping. Keycloak remains the source of roles;
 * this configuration only creates the platform membership boundary for the
 * verified Keycloak subject supplied by deployment secrets.
 */
@ConfigurationProperties(prefix = "iot.bootstrap")
public class BootstrapOwnerProperties {

    private boolean requireOwner;
    private String ownerSubject;
    private String ownerUsername;
    private String ownerDisplayName;
    private String ownerEmail;
    private String organizationCode;
    private String organizationName;
    private String siteCode;
    private String siteName;
    private String spacePath = "/operations";
    private String spaceName = "Operations";

    public boolean isRequireOwner() {
        return requireOwner;
    }

    public void setRequireOwner(boolean requireOwner) {
        this.requireOwner = requireOwner;
    }

    public String getOwnerSubject() {
        return ownerSubject;
    }

    public void setOwnerSubject(String ownerSubject) {
        this.ownerSubject = ownerSubject;
    }

    public String getOwnerUsername() {
        return ownerUsername;
    }

    public void setOwnerUsername(String ownerUsername) {
        this.ownerUsername = ownerUsername;
    }

    public String getOwnerDisplayName() {
        return ownerDisplayName;
    }

    public void setOwnerDisplayName(String ownerDisplayName) {
        this.ownerDisplayName = ownerDisplayName;
    }

    public String getOwnerEmail() {
        return ownerEmail;
    }

    public void setOwnerEmail(String ownerEmail) {
        this.ownerEmail = ownerEmail;
    }

    public String getOrganizationCode() {
        return organizationCode;
    }

    public void setOrganizationCode(String organizationCode) {
        this.organizationCode = organizationCode;
    }

    public String getOrganizationName() {
        return organizationName;
    }

    public void setOrganizationName(String organizationName) {
        this.organizationName = organizationName;
    }

    public String getSiteCode() {
        return siteCode;
    }

    public void setSiteCode(String siteCode) {
        this.siteCode = siteCode;
    }

    public String getSiteName() {
        return siteName;
    }

    public void setSiteName(String siteName) {
        this.siteName = siteName;
    }

    public String getSpacePath() {
        return spacePath;
    }

    public void setSpacePath(String spacePath) {
        this.spacePath = spacePath;
    }

    public String getSpaceName() {
        return spaceName;
    }

    public void setSpaceName(String spaceName) {
        this.spaceName = spaceName;
    }
}
