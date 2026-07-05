import type { Db } from './db/db.js';
import type { Config } from './config.js';
import type { EventBus } from './lib/events.js';
import type { Mailer } from './lib/mailer.js';
import type { FileStorage } from './lib/storage.js';

/** Dependency container handed to every module at registration. */
export interface AppCtx {
  db: Db;
  config: Config;
  bus: EventBus;
  mailer: Mailer;
  storage: FileStorage;
}
