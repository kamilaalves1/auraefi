import Database from 'better-sqlite3'
const db = new Database('.data/mission-control.db')
const info = db.prepare("PRAGMA table_info(pipeline_columns)").all()
console.log('Columns schema:', JSON.stringify(info, null, 2))
const cols = db.prepare('SELECT * FROM pipeline_columns ORDER BY id').all()
console.log('Columns data:', JSON.stringify(cols, null, 2))
