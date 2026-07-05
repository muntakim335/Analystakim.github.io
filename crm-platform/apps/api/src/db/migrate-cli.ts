import { loadConfig } from '../config.js';
import { createPgDb } from './db.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const db = createPgDb(config.DATABASE_URL);
migrate(db)
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
    return db.close();
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
