// Secrets in text a model or an agent wrote (a sentence, a bubble, a step, a task, a tool's pattern): masked before a
// person sees it. Each rule keeps what names a secret and masks its value; a path, an identifier or a plain number is
// left as it was.

const MASK = '***'

// a word that names a secret, in English or Thai (Thai has no word breaks for \b to find): what follows it is its value
const SECRET_WORD = String.raw`((?:\b\w*(?:token|secret|password|passwd|pwd|api[_\s-]?key|credential)\w*)|รหัสผ่าน|รหัส|โทเคน)`
// a value after `:` or a space that reads like a secret: quoted, or letters and digits both (so "401" and "2 of 3" stay),
// never a version (v2, v1.2.3)
const SECRET_VALUE = String.raw`("[^"]*"|'[^']*'|(?!v\d+(?:\.\d+)*(?:[\s,;]|$))(?=[^\s,;]*\d)(?=[^\s,;]*[A-Za-z])[^\s,;]+)`

// each pattern finds a secret; the replacement keeps what names it and masks the value
const SECRETS: readonly [RegExp, string][] = [
  [/\b(hooks\.slack\.com\/services\/)\S+/gi, `$1${MASK}`], // Slack webhook URLs
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${MASK}@`], // credentials in a URL
  [/(^|\s)(-u\s*|--user[=\s]\s*)([^\s:'"]+):("[^"]*"|'[^']*'|[^\s"']+)/g, `$1$2$3:${MASK}`], // curl -u user:pass
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, MASK], // API keys (OpenAI-style, Anthropic, Stripe)
  [/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{8,}/g, MASK], // GitHub tokens
  [/\bxox[abprs]-[A-Za-z0-9-]{8,}/g, MASK], // Slack tokens
  [/\b(?:AKIA|ASIA)[0-9A-Z]{12,}/g, MASK], // AWS access key ids
  [/\bAIza[0-9A-Za-z_-]{20,}/g, MASK], // Google API keys
  [/\bya29\.[A-Za-z0-9_-]{10,}/g, MASK], // Google OAuth access tokens
  [/\bglpat-[A-Za-z0-9_-]{10,}/g, MASK], // GitLab personal access tokens
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, MASK], // JWTs
  [/\b(Bearer|Basic)\s+\S+/gi, `$1 ${MASK}`],
  [/\b([A-Z][A-Z0-9_]+)=("[^"]*"|'[^']*'|\S+)/g, `$1=${MASK}`], // ENV_NAME=value
  [new RegExp(String.raw`${SECRET_WORD}(\s*=\s*)("[^"]*"|'[^']*'|\S+)`, 'gi'), `$1$2${MASK}`], // password=…
  // `token: …`, `--password hunter2now`, `the password is hunter2now`, `รหัสผ่าน hunter2now`
  [new RegExp(String.raw`${SECRET_WORD}(\s*:\s*|\s+(?:is\s+)?)${SECRET_VALUE}`, 'gi'), `$1$2${MASK}`],
]

// whole words joined into a name: lowercase words, Capitalised words and numbers (camelCase, PascalCase, a path's folder)
const WORDS = /^(?:[a-z]{2,}|[A-Z][a-z]+|\d+)+$/
/** snake_case, SCREAMING_SNAKE, camelCase or PascalCase: an identifier, not a key. */
const isIdentifier = (run: string) => run.split('_').filter(Boolean).every(part => WORDS.test(part) || /^[A-Z]+\d*$/.test(part))

// a long run of letters and digits (a hash, a key) says nothing a person needs; an identifier that long does
const OPAQUE = /[A-Za-z0-9+=_]{32,}/g
// a run of 40 or more with slashes, in both cases and with digits, not a file's name (no extension after it) and not a
// path of words: an AWS secret access key
const SLASHED = /[A-Za-z0-9/+]{40,}(?![A-Za-z0-9/+]|\.[A-Za-z0-9])/g // a full stop ending a sentence is no extension
const isWordPath = (run: string) => run.split('/').filter(Boolean).every(segment => WORDS.test(segment))

/** `text` with every secret it seems to hold replaced by ***. */
export function maskSecrets(text: string): string {
  const named = SECRETS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)
  return named
    .replace(OPAQUE, run => (/\d/.test(run) && /[A-Za-z]/.test(run) && !isIdentifier(run) ? MASK : run))
    .replace(SLASHED, run => (/\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run) && !isWordPath(run) ? MASK : run))
}
