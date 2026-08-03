-- V2 introduced organization, site, and space, but early demo devices were
-- intentionally preserved without an ownership context. A device that appears
-- in the enterprise inventory must have the same scope required by groups and
-- batches, so adopt those legacy records into the default demo hierarchy.

INSERT INTO organizations (code, name)
SELECT 'demo-org', 'Demo Organization'
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE code = 'demo-org');

INSERT INTO sites (organization_id, code, name)
SELECT organization.id, 'demo-site', 'Demo Site'
FROM organizations organization
WHERE organization.code = 'demo-org'
  AND NOT EXISTS (
      SELECT 1 FROM sites site
      WHERE site.organization_id = organization.id AND site.code = 'demo-site'
  );

INSERT INTO spaces (site_id, parent_id, name, path)
SELECT site.id, NULL, 'Operations', '/operations'
FROM sites site
JOIN organizations organization ON organization.id = site.organization_id
WHERE organization.code = 'demo-org' AND site.code = 'demo-site'
  AND NOT EXISTS (
      SELECT 1 FROM spaces space
      WHERE space.site_id = site.id AND space.path = '/operations'
  );

INSERT INTO spaces (site_id, parent_id, name, path)
SELECT site.id, operations.id, 'Field', '/operations/field'
FROM sites site
JOIN organizations organization ON organization.id = site.organization_id
JOIN spaces operations ON operations.site_id = site.id AND operations.path = '/operations'
WHERE organization.code = 'demo-org' AND site.code = 'demo-site'
  AND NOT EXISTS (
      SELECT 1 FROM spaces field
      WHERE field.site_id = site.id AND field.path = '/operations/field'
  );

UPDATE devices
SET organization_id = (SELECT id FROM organizations WHERE code = 'demo-org')
WHERE organization_id IS NULL;

UPDATE devices
SET site_id = (
    SELECT site.id FROM sites site
    JOIN organizations organization ON organization.id = site.organization_id
    WHERE organization.code = 'demo-org' AND site.code = 'demo-site'
)
WHERE site_id IS NULL;

UPDATE devices
SET space_id = (
    SELECT space.id FROM spaces space
    JOIN sites site ON site.id = space.site_id
    JOIN organizations organization ON organization.id = site.organization_id
    WHERE organization.code = 'demo-org' AND site.code = 'demo-site'
      AND space.path = '/operations/field'
)
WHERE space_id IS NULL;
