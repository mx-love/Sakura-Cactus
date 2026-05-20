-- Add email login support for the administrator account.

ALTER TABLE users ADD COLUMN email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
