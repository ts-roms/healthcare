-- Guided tour of the staff app: the organization may switch it off for every member of staff.
--
-- One row per organization, created the first time an administrator changes it. No row means the tour is on (the
-- default). The tour itself is a per-browser walk-through with no clinical content; this only decides whether the
-- organization offers it. Changing it needs `organization.manage` and is audited (`tour.setting.update`).

CREATE TABLE staff_tour_setting (
  organization_id  uuid        PRIMARY KEY REFERENCES organization (id),
  enabled          boolean     NOT NULL DEFAULT true,
  updated_by       uuid        NOT NULL REFERENCES app_user (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer     NOT NULL DEFAULT 1 CHECK (version > 0)
);
