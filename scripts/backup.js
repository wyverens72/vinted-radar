import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
const source=process.env.DATABASE_PATH||'./data/radar.sqlite';
mkdirSync('./backups',{recursive:true});
const target=`./backups/radar-${new Date().toISOString().replaceAll(':','-')}.sqlite`;
const db=new DatabaseSync(source);
await backup(db,target);db.close();console.log(`Backup: ${target}`);
