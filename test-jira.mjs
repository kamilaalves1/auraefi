import Database from 'better-sqlite3'
import { createDecipheriv } from 'crypto'

const db = new Database('.data/mission-control.db')
const p = db.prepare('SELECT config_json, secret_blob FROM work_pipelines WHERE id = 13').get()
const cfg = JSON.parse(p.config_json)

// Decrypt secret_blob using same method as the app
function decrypt(blob) {
  if (!blob) return {}
  try {
    const [ivHex, encHex] = blob.split(':')
    const key = Buffer.from(process.env.AUTH_SECRET || '', 'hex').slice(0, 32)
    const iv = Buffer.from(ivHex, 'hex')
    const enc = Buffer.from(encHex, 'hex')
    const decipher = createDecipheriv('aes-256-cbc', key, iv)
    const dec = Buffer.concat([decipher.update(enc), decipher.final()])
    return JSON.parse(dec.toString())
  } catch (e) {
    return { error: e.message }
  }
}

// Load AUTH_SECRET from .auto-generated
import { readFileSync } from 'fs'
const autoGen = readFileSync('.data/.auto-generated', 'utf-8')
const authSecret = autoGen.match(/AUTH_SECRET=(.+)/)?.[1]?.trim()
process.env.AUTH_SECRET = authSecret

const secrets = decrypt(p.secret_blob)
console.log('Config:', JSON.stringify(cfg, null, 2))
console.log('Secrets keys:', Object.keys(secrets))

// Query JIRA for cards in "Itens Pendentes"
const host = cfg.jiraHost.replace(/\/+$/, '')
const email = cfg.jiraAccountEmail
const token = secrets.jiraApiToken
const projectKey = cfg.jiraProjectKey

if (!token) {
  console.log('ERROR: jiraApiToken is empty/missing in secrets')
  process.exit(1)
}

const auth = Buffer.from(`${email}:${token}`).toString('base64')

// First: resolve status ID
const statusRes = await fetch(`${host}/rest/api/3/project/${projectKey}/statuses`, {
  headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }
})
const statusData = await statusRes.json()
let statusId = null
for (const type of statusData) {
  for (const s of (type.statuses || [])) {
    console.log('  Status:', s.name, '→', s.id)
    if (s.name.toLowerCase() === 'itens pendentes') statusId = s.id
  }
}
console.log('Status ID for "Itens Pendentes":', statusId)

// Query issues in that status
const statusFilter = statusId ? `status in (${statusId})` : `status = "Itens Pendentes"`
const jql = `project = ${projectKey} AND ${statusFilter} ORDER BY updated DESC`
console.log('JQL:', jql)

const searchRes = await fetch(`${host}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=10&fields=summary,status`, {
  headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }
})
const searchData = await searchRes.json()
console.log('Search status:', searchRes.status)
console.log('Issues found:', searchData.issues?.length ?? 0)
for (const issue of (searchData.issues || [])) {
  console.log(' -', issue.key, '|', issue.fields?.summary, '| status:', issue.fields?.status?.name)
}
if (searchData.errorMessages) console.log('Errors:', searchData.errorMessages)
