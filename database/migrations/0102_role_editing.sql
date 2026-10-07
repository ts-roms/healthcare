-- Staff administration (docs/security/access-control.md, "Roles"; D10): an organization's own roles can be edited.
--
-- Optimistic locking for role edits: name, description and the permission set are replaced together in one
-- transaction, and a stale screen is refused (409 version_conflict). Built-in roles (organization_id IS NULL) stay
-- read-only; the key never changes. Who may hand out or take away a permission stays the rule it was for granting:
-- only someone who holds it. Nothing is deleted: a role nobody should hold is revoked per person.

ALTER TABLE role ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
