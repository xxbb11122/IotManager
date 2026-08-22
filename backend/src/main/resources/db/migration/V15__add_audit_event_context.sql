-- P0 audit traceability: preserve the actor and resource boundary that were
-- in effect when an activity or command transition was recorded.  The columns
-- remain nullable because legacy rows and trusted system/edge-agent actions do
-- not always have an AppUser actor.
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS actor_id BIGINT;
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS organization_id BIGINT;
ALTER TABLE activity_events ADD COLUMN IF NOT EXISTS site_id BIGINT;

ALTER TABLE command_events ADD COLUMN IF NOT EXISTS actor_id BIGINT;
ALTER TABLE command_events ADD COLUMN IF NOT EXISTS organization_id BIGINT;
ALTER TABLE command_events ADD COLUMN IF NOT EXISTS site_id BIGINT;

-- Backfill immutable scope from the device that owned the historical event.
-- Correlated subqueries are supported by both H2 (development/tests) and
-- PostgreSQL (production) and avoid a dialect-specific UPDATE ... FROM.
UPDATE activity_events
SET organization_id = (
        SELECT organization_id FROM devices WHERE devices.id = activity_events.device_id
    ),
    site_id = (
        SELECT site_id FROM devices WHERE devices.id = activity_events.device_id
    )
WHERE organization_id IS NULL OR site_id IS NULL;

UPDATE command_events
SET organization_id = (
        SELECT devices.organization_id
        FROM device_commands
        JOIN devices ON devices.id = device_commands.device_id
        WHERE device_commands.id = command_events.command_id
    ),
    site_id = (
        SELECT devices.site_id
        FROM device_commands
        JOIN devices ON devices.id = device_commands.device_id
        WHERE device_commands.id = command_events.command_id
    )
WHERE organization_id IS NULL OR site_id IS NULL;

ALTER TABLE activity_events
    ADD CONSTRAINT fk_activity_events_actor FOREIGN KEY (actor_id) REFERENCES app_users (id);
ALTER TABLE activity_events
    ADD CONSTRAINT fk_activity_events_organization FOREIGN KEY (organization_id) REFERENCES organizations (id);
ALTER TABLE activity_events
    ADD CONSTRAINT fk_activity_events_site FOREIGN KEY (site_id) REFERENCES sites (id);

ALTER TABLE command_events
    ADD CONSTRAINT fk_command_events_actor FOREIGN KEY (actor_id) REFERENCES app_users (id);
ALTER TABLE command_events
    ADD CONSTRAINT fk_command_events_organization FOREIGN KEY (organization_id) REFERENCES organizations (id);
ALTER TABLE command_events
    ADD CONSTRAINT fk_command_events_site FOREIGN KEY (site_id) REFERENCES sites (id);

CREATE INDEX IF NOT EXISTS idx_activity_events_site_occurred
    ON activity_events (site_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_activity_events_actor_occurred
    ON activity_events (actor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_command_events_site_occurred
    ON command_events (site_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_command_events_actor_occurred
    ON command_events (actor_id, occurred_at);
