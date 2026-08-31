package com.iot.manager.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Production membership bootstrap. Keycloak remains the source of roles;
 * this configuration only creates platform membership boundaries for verified
 * Keycloak subjects supplied by deployment configuration. Integration-only
 * fields let a real Keycloak runtime exercise OWNER, ADMIN, OPERATOR and
 * VIEWER without treating production owner bootstrap as a general user
 * provisioning mechanism.
 */
@ConfigurationProperties(prefix = "iot.bootstrap")
public class BootstrapOwnerProperties {

    private boolean requireOwner;
    private String ownerSubject;
    private String ownerUsername;
    private String ownerDisplayName;
    private String ownerEmail;
    private String viewerSubject;
    private String viewerUsername;
    private String viewerDisplayName;
    private String viewerEmail;
    private boolean integrationIdentitiesEnabled;
    private String adminSubject;
    private String adminUsername;
    private String adminDisplayName;
    private String adminEmail;
    private String operatorSubject;
    private String operatorUsername;
    private String operatorDisplayName;
    private String operatorEmail;
    private String organizationCode;
    private String organizationName;
    private String siteCode;
    private String siteName;
    private String secondarySiteCode;
    private String secondarySiteName;
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

    public String getViewerSubject() {
        return viewerSubject;
    }

    public void setViewerSubject(String viewerSubject) {
        this.viewerSubject = viewerSubject;
    }

    public String getViewerUsername() {
        return viewerUsername;
    }

    public void setViewerUsername(String viewerUsername) {
        this.viewerUsername = viewerUsername;
    }

    public String getViewerDisplayName() {
        return viewerDisplayName;
    }

    public void setViewerDisplayName(String viewerDisplayName) {
        this.viewerDisplayName = viewerDisplayName;
    }

    public String getViewerEmail() {
        return viewerEmail;
    }

    public void setViewerEmail(String viewerEmail) {
        this.viewerEmail = viewerEmail;
    }

    public boolean isIntegrationIdentitiesEnabled() {
        return integrationIdentitiesEnabled;
    }

    public void setIntegrationIdentitiesEnabled(boolean integrationIdentitiesEnabled) {
        this.integrationIdentitiesEnabled = integrationIdentitiesEnabled;
    }

    public String getAdminSubject() {
        return adminSubject;
    }

    public void setAdminSubject(String adminSubject) {
        this.adminSubject = adminSubject;
    }

    public String getAdminUsername() {
        return adminUsername;
    }

    public void setAdminUsername(String adminUsername) {
        this.adminUsername = adminUsername;
    }

    public String getAdminDisplayName() {
        return adminDisplayName;
    }

    public void setAdminDisplayName(String adminDisplayName) {
        this.adminDisplayName = adminDisplayName;
    }

    public String getAdminEmail() {
        return adminEmail;
    }

    public void setAdminEmail(String adminEmail) {
        this.adminEmail = adminEmail;
    }

    public String getOperatorSubject() {
        return operatorSubject;
    }

    public void setOperatorSubject(String operatorSubject) {
        this.operatorSubject = operatorSubject;
    }

    public String getOperatorUsername() {
        return operatorUsername;
    }

    public void setOperatorUsername(String operatorUsername) {
        this.operatorUsername = operatorUsername;
    }

    public String getOperatorDisplayName() {
        return operatorDisplayName;
    }

    public void setOperatorDisplayName(String operatorDisplayName) {
        this.operatorDisplayName = operatorDisplayName;
    }

    public String getOperatorEmail() {
        return operatorEmail;
    }

    public void setOperatorEmail(String operatorEmail) {
        this.operatorEmail = operatorEmail;
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

    public String getSecondarySiteCode() {
        return secondarySiteCode;
    }

    public void setSecondarySiteCode(String secondarySiteCode) {
        this.secondarySiteCode = secondarySiteCode;
    }

    public String getSecondarySiteName() {
        return secondarySiteName;
    }

    public void setSecondarySiteName(String secondarySiteName) {
        this.secondarySiteName = secondarySiteName;
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
