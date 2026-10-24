CREATE TABLE browser_logins(token TEXT PRIMARY KEY,userId TEXT REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE INDEX browser_logins_expiry ON browser_logins(expires);
