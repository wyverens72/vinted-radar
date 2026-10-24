import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDb(path) {
  mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS searches(id TEXT PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL, brand TEXT NOT NULL, size TEXT NOT NULL, maxPrice REAL NOT NULL, intervalMinutes INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, lastChecked INTEGER, nextCheck INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE TABLE IF NOT EXISTS matches(searchId TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE, itemId TEXT NOT NULL, item TEXT NOT NULL, foundAt INTEGER NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(searchId,itemId));
    CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY, searchId TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE, itemId TEXT NOT NULL, text TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, nextAttempt INTEGER NOT NULL DEFAULT 0, sentAt INTEGER, UNIQUE(searchId,itemId));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  return db;
}
export function setting(db,key,value) {
  if(value!==undefined) db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
}
