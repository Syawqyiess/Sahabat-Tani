'use strict';
require('dotenv').config({ quiet: true });
const db = require('./index');

(async () => {
  const applied = await db.migrate();
  console.log(applied.length ? `Migrasi diterapkan: ${applied.join(', ')}` : 'Database sudah mutakhir.');
  await db.close();
})().catch((err) => { console.error(err.message); process.exit(1); });
