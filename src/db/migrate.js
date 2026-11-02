'use strict';
const db = require('./index');

const applied = db.migrate();
console.log(applied.length ? `Migrasi diterapkan: ${applied.join(', ')}` : 'Database sudah mutakhir.');
db.close();
