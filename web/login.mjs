// `node server.mjs --login --state <file>`: asks the running hub for a fresh one-time login link and prints it as
// `AGENT_HQ_URL <url>`. The mod uses it when /hq web is run again in a session whose page is already up (the link
// printed at the start has been used). Exits 0 with the line, or 1 with the reason on stderr. No dependencies.

import { dirname } from 'node:path'
import { localRequest } from './http.mjs'
import { pidAlive, readRegistry } from './registry.mjs'

export async function printLoginUrl(statePath) {
  const info = readRegistry(dirname(statePath))
  if (!info || !pidAlive(info.pid)) {
    console.error('agent-hq web: no page is running (no live hub); run /hq web again')
    return 1
  }
  const answer = await localRequest(info.port, '/hub/code', { method: 'POST', secret: info.secret })
  if (typeof answer?.json?.code !== 'string') {
    console.error('agent-hq web: the hub did not give a login code')
    return 1
  }
  console.log(`AGENT_HQ_URL http://127.0.0.1:${info.port}/?c=${answer.json.code}`)
  return 0
}
