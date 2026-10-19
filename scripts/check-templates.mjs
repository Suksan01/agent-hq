// Checks every team template (templates/*.json): it parses, index.json lists it, and its lead runs on opus. The mod's
// own tests cannot read JSON files (the test runner loads code only), so this runs on its own:
// node scripts/check-templates.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')
const LEAD_MODEL = 'opus'

const problems = []
const read = file => {
  try {
    return JSON.parse(readFileSync(join(DIR, file), 'utf8'))
  } catch (error) {
    problems.push(`${file}: not valid JSON (${error.message})`)
    return null
  }
}

const files = readdirSync(DIR).filter(file => file.endsWith('.json') && file !== 'index.json')
const listed = (read('index.json') ?? []).map(entry => `${entry.id}.json`)
for (const file of files) {
  if (!listed.includes(file)) problems.push(`${file}: missing from index.json`)
  const template = read(file)
  if (template && template.lead?.model !== LEAD_MODEL) problems.push(`${file}: the lead's "model" is ${JSON.stringify(template.lead?.model)}, not "${LEAD_MODEL}"`)
}
for (const file of listed) if (!files.includes(file)) problems.push(`index.json lists ${file}, which does not exist`)

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`${files.length} templates checked: all listed in index.json, every lead on ${LEAD_MODEL}`)
