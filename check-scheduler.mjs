// Hit the scheduler status API with admin credentials
const res = await fetch('http://localhost:3000/api/scheduler/status', {
  headers: {
    'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64')
  }
})
const data = await res.json()
const pe = data.tasks?.find(t => t.id === 'pipeline_engine')
console.log('pipeline_engine task:', JSON.stringify(pe, null, 2))
