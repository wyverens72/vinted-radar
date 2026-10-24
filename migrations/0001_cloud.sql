PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY, telegramId TEXT UNIQUE, name TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
 chatId TEXT, notifications INTEGER NOT NULL DEFAULT 0,
 enabled INTEGER NOT NULL DEFAULT 1, notificationError TEXT,
 lastManual INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL
);
INSERT INTO users(id,name,role,createdAt) VALUES('owner','Владелец','owner',0);
CREATE TABLE sessions(token TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE searches (
 id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,query TEXT NOT NULL,brand TEXT NOT NULL,size TEXT NOT NULL,
 maxPrice REAL NOT NULL,intervalMinutes INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
 lastChecked INTEGER,nextCheck INTEGER NOT NULL DEFAULT 0,error TEXT,createdAt INTEGER NOT NULL
);
CREATE INDEX searches_owner ON searches(userId,createdAt DESC);
CREATE INDEX searches_due ON searches(enabled,nextCheck);
CREATE TABLE matches (
 searchId TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,itemId TEXT NOT NULL,
 item TEXT NOT NULL,foundAt INTEGER NOT NULL,favorite INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(searchId,itemId)
);
CREATE INDEX matches_date ON matches(foundAt DESC);
CREATE TABLE outbox (
 id TEXT PRIMARY KEY,searchId TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
 itemId TEXT NOT NULL,text TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
 nextAttempt INTEGER NOT NULL DEFAULT 0,sentAt INTEGER,
 UNIQUE(searchId,itemId)
);
CREATE INDEX outbox_due ON outbox(sentAt,nextAttempt);
CREATE TABLE invites (
 token TEXT PRIMARY KEY,createdAt INTEGER NOT NULL,expires INTEGER NOT NULL,usedBy TEXT,
 revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE login_codes(token TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE leases(key TEXT PRIMARY KEY,token TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE updates(id INTEGER PRIMARY KEY,status TEXT NOT NULL,leaseUntil INTEGER NOT NULL,createdAt INTEGER NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE feed(id TEXT PRIMARY KEY,item TEXT NOT NULL);
