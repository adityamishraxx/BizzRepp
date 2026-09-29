-- Migration 032: Sync super_admin_scope across all rows sharing the same email.
-- Previously the GA grant lived on only one row per email. Auto-provisioned accounts
-- in other businesses had NULL, so switching platforms lost GA status.

UPDATE users u
JOIN (
  SELECT LOWER(email) AS lemail, MAX(super_admin_scope) AS scope
  FROM users
  WHERE super_admin_scope IS NOT NULL AND email IS NOT NULL
  GROUP BY LOWER(email)
) ga ON LOWER(u.email) = ga.lemail
SET u.super_admin_scope = ga.scope
WHERE u.super_admin_scope IS NULL;
