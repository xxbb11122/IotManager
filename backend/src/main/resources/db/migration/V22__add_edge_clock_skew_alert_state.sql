-- P0-TIME-01: persist the consecutive skew state so a process restart cannot
-- suppress or multiply the diagnostic alert.  The alert is site-scoped rather
-- than device-scoped because an edge agent can serve many devices.

ALTER TABLE edge_agents ADD COLUMN IF NOT EXISTS clock_skew_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE edge_agents ADD COLUMN IF NOT EXISTS clock_skew_alerted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS site_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_alerts_site_open_code
    ON alerts (site_id, resolved, alert_code);
