-- R1 multi-site authorization and audit reads. These indexes contain no new
-- data and are safe for both legacy and newly provisioned installations.
CREATE INDEX IF NOT EXISTS idx_site_memberships_user_site
    ON site_memberships (user_id, site_id);

CREATE INDEX IF NOT EXISTS idx_organization_memberships_user_organization
    ON organization_memberships (user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_devices_organization_site_archived
    ON devices (organization_id, site_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_activity_events_scope_occurred
    ON activity_events (organization_id, site_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_command_events_scope_occurred
    ON command_events (organization_id, site_id, occurred_at);
