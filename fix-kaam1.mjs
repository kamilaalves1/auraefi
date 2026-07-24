import Database from 'better-sqlite3'
const db = new Database('.data/mission-control.db')

const r = db.prepare("UPDATE pipeline_card_runs SET status='cancelled', updated_at=strftime('%s','now') WHERE card_key='KAAM-1' AND status IN ('pending','failed')").run()
console.log('KAAM-1 updated rows:', r.changes)

const runs = db.prepare('SELECT id, card_key, status, current_stage_id, updated_at FROM pipeline_card_runs').all()
console.log('All runs:', JSON.stringify(runs, null, 2))

const cols = db.prepare('SELECT id, name, trigger_fetch FROM pipeline_columns ORDER BY id').all()
console.log('Columns:', JSON.stringify(cols, null, 2))
