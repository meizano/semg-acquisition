const { Client } = require('pg');
const c = new Client(process.env.DATABASE_URL || 'postgresql://postgres:123@localhost:5432/emg_db');
c.connect()
  .then(() => c.query('SELECT count(*) as total, count(distinct "sessionId") as sessions FROM "EmgRecord"'))
  .then(r => console.log('EmgRecord summary:', r.rows))
  .then(() => c.query('SELECT * FROM "EmgRecord" ORDER BY "createdAt" DESC LIMIT 1'))
  .then(r => console.log('Sample record:', r.rows[0]))
  .finally(() => c.end());
