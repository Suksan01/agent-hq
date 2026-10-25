# Hardened page approvals (0.8.0)

Status: spec (draft)

## Direction

Approving an agent's permission ask on the live page needs a passkey check (WebAuthn with user verification, Touch ID
on a Mac). The page registers the passkey once; the hub verifies each approval's signature with Node's own crypto, no
new dependency. An agent can read every file but cannot press Touch ID.

Rejected: a code shown only in the terminal (the person must look at the terminal anyway), and view-only cards
(drops the feature).

## The person's answers

- Threat: a prompt-injected agent of this session on this Mac, with Read and Bash (reads any file, runs curl against
  localhost, reads hub.json), must never approve its own ask, forge an approval card or log into the page.
- Out of scope: other OS users, malware outside Claude, approving from another device on the network.

## What the spec must settle

- **Registration is the weak point.** An agent can run the WebAuthn ceremony with a software key it made itself, so
  registering a passkey needs a proof only the person has (for example a one-time code shown only in the terminal).
- **The stored public key is writable.** The agent runs as the same OS user and can overwrite any file, so the
  registered key must live where it cannot be swapped unseen (the mod's memory per session, or `$.store` if agents
  cannot write it: unconfirmed).
- **Attack surface today** (senior-dev-2's report, `.claude/agent-hq/reports/senior-dev/senior-dev-2.md`): the hub secret
  in hub.json gives the cookie (`web/hub.mjs:44`), `/hub/code` mints login codes (`hub.mjs:202`), the `/events` stream
  carries card tokens (`web/approvals.mjs:58`), `/approval/<id>` accepts forged Origin/Host/Sec-Fetch-Site headers
  (`hub.mjs:232-241`), and the secret also forges cards (`/hub/approval`), sessions (`/hub/register`) and lead text
  (`/action`).
- **Two failing wiring tests are test bugs** (same report): the "decider host" case cannot be produced by a hook mock
  (move it to `canHold` unit coverage), and the "cannot attest" case needs `AskUserQuestion` allowed in the test.

---

# Spec

## 1. Goal and who it's for

The person who runs Claude Code with an Agent HQ team on their own Mac. Their words (brainstorm): a prompt-injected
agent of this session, with Read and Bash, must never approve its own ask, forge an approval card or log into the page.
Goal: answering a permission ask on the live page is possible again (it ships dormant since 0.7.0,
`hooks/pageapproval.ts:9-11`) and only the person's Touch ID can allow.

Design rule: **the hub is untrusted transport.** The hub, its secret, its cookie and its endpoints can all be reached by
the agent, so none of them may decide an approval. The decision is checked by code the agent cannot write to or read
the memory of: the mod (holds the key and the challenge) and `web/approve.mjs`, which the mod spawns and feeds on stdin.

## 2. Flows

Names below: MOD = `hooks/register.tsx` + `hooks/pageapproval.ts`; HUB = `web/hub.mjs`; APPR = `web/approvals.mjs`;
HELPER = `web/approve.mjs`; SRV = `web/server.mjs`; PAGE = `web/index.html` + `web/approval.js` (+ a new
`web/passkey.js`) + `web/i18n.js`.

### 2.1 Register the passkey (once per session, see 3.1)
1. The person types `/hq web approvals on` (MOD, origin gate as today). With no key registered the reply says so and
   MOD mints a 8-digit one-time registration code in memory (expires in 2 minutes, 3 tries) and shows it in a toast
   (`$.ui.toast`, `LINK_NOTICE_MS`): toasts never reach the transcript, the reply or any file.
2. The PAGE shows the registration screen (needs the login cookie, HUB `GET /state` `/events`). The person types the code
   and presses Register: PAGE runs `navigator.credentials.create` (ES256, `userVerification: "required"`,
   `authenticatorAttachment: "platform"`, rpId `localhost`), reads `response.getPublicKey()` (SPKI DER, base64).
3. PAGE `POST /register-passkey {code, credentialId, publicKey}` (HUB, cookie + same-origin checks as `/action`).
4. HUB relays it to MOD as a new action kind `passkey` (`web/queue.mjs` checkKind, SRV `/hub/forward`, then the
   `AGENT_HQ_ACTION` line MOD already reads; `hooks/actions.ts`). MOD compares the code (constant time), checks the key
   parses as an EC P-256 SPKI with Node `crypto` (in HELPER, see 2.2; MOD only stores the string), keeps
   `{credentialId, publicKey}` in its own memory, forgets the code and tells the page (state file) and the person (toast).
5. An agent that runs the ceremony with a software key fails at step 4: it lacks the code (only in the toast / person's
   eyes). Three wrong codes or 2 minutes burn the code; a new `/hq web approvals on` mints another.

### 2.2 An ask is held and the person approves or denies
1. Engine `tool.check` -> MOD `askOnPage` (existing conditions in `canHold`, plus: a key is registered).
2. MOD builds a card `{id, nonce(32 random bytes), agent, tool, input, reason, ...}` and spawns HELPER with that request
   **and the public key + origin on stdin** (never read from disk).
3. HELPER `POST /hub/approval` (HUB `holdApproval`, APPR `hold`); HUB emits SSE `approval` with the card, the nonce and
   the one-time token (as today, `approvals.mjs:58`).
4. PAGE shows the card. Allow: PAGE computes `challenge = SHA-256(canonical JSON of {id, tool, input, reason, nonce,
   decision:"allow"})` from the card it displays, runs `navigator.credentials.get` (`userVerification: "required"`) and
   `POST /approval/<id> {token, decision:"allow", assertion}`. Deny: `{token, decision:"deny"}`, no touch needed.
5. HUB passes the answer on to HELPER unchecked for authority (APPR keeps token, order and busy rules). HELPER recomputes
   the challenge **from the request it received from MOD**, then verifies with `node:crypto` (`verify` SHA-256 over
   `authData || SHA-256(clientDataJSON)` with the stored SPKI key): `clientDataJSON.type == "webauthn.get"`,
   `.challenge` equals ours, `.origin` equals `http://localhost:<hub port>`, `authData` rpIdHash is SHA-256("localhost"),
   flags UP and UV set, signature counter above the last seen (when non-zero). Only then HELPER prints `allow`.
   Anything else prints `ask` (the engine's dialog follows). `deny` is accepted unsigned: it only makes things safer.
6. MOD maps the line as today (`answerOf`, `ALLOWED`/`DENIED`).
Because HELPER re-derives the challenge from MOD's own copy, a hub or page that altered the card (tool, input) cannot
get a valid allow.

### 2.3 No passkey, no WebAuthn, timeout
- **No passkey registered:** `canHold` is false: no card, the dialog asks as today. `/hq web approvals on` still sets
  the setting and says "register a passkey on the page". The page shows the registration screen, not a card.
- **Browser without WebAuthn / no platform authenticator / user cancels the touch:** PAGE shows the "cannot approve
  here" state; the card can only Deny or "Ask in terminal now" (answer `ask`). No fallback to a password or a code:
  nothing weaker than Touch ID may allow.
- **Timeout (60 s, `APPROVAL_MS`):** APPR settles `ask`, withdraws the card; the dialog follows. Esc kills HELPER and the
  hub withdraws the card (as today).

### 2.4 `/hq web approvals on|off|(bare)`
- `on` from the person's own run (`PERSON_ORIGINS`): sets the setting; if no key, starts 2.1. From
  `unclassified`/`auto-continuation`: the dialog first (`approvalsOnFrom`), unchanged. Plugin, schedule, other session:
  refused (`approvals.notYours`), unchanged.
- `off`: open to every run, as today; also forgets the registered key and the code.
- Bare: says on/off and whether a passkey is registered.
- The setting is only a convenience switch now, not a security boundary: see 3.1.
- `APPROVALS_RELEASED` becomes `true`; the env gate `AGENT_HQ_APPROVALS` (SRV:54) and the `web.approvalsComing` reply
  go; `APPROVALS_TEST_SESSION` is removed once the tests run on the real path.

## 3. Data

### 3.1 Where the public key lives
In the mod's memory for the session (the same place as its other plain session state, never a file). Why: `$.store`
is "a JSON file of the plugin's own under the user's Claude Code configuration directory" (engine types, `store`): the
agent runs as the same OS user and can overwrite it with Write or Bash, so a key there can be swapped unseen. Nor may
the key sit in hub memory, state files, `pages.json` or `hub.json`: the secret holder can write all of those. The key
reaches HELPER only on its stdin from MOD. Cost: register again each session (one code, one touch).
`$.store` keeps only the boolean `pageApprovals`; tampering with it is harmless (turning it on with no key holds
nothing; turning it off falls back to the dialog).

### 3.2 hub.json and its secret
Stays `{port, pid, secret}`, mode 0600 (`web/registry.mjs`): older session servers in other running sessions still read
it. Its power shrinks: (a) the browser cookie is no longer `HMAC(secret)` (`hub.mjs:44`) but random per hub run, held
in hub memory (a hub takeover now asks the browser to log in again); (b) `/hub/approval` and `/hub/register` stay but
decide nothing; (c) `/hub/code` stays (needed by `/hq web`), so an agent can still reach a logged-in page: it gets
view-only plus the `/action` kinds (see open question 1), never an approval.
The page URL printed by `AGENT_HQ_URL` uses `localhost`, not `127.0.0.1`: WebAuthn rejects an IP as rpId. HUB already
accepts both hosts (`hostIsLocal`); the cookie is per host so the person logs in on the new URL.

### 3.3 Must not break
`hub.json` shape; `pages.json {count, at}` (`pageCount`); state file and `*.queue.jsonl` formats and the
replay-once rule (`lastAction`); the `AGENT_HQ_URL`/`AGENT_HQ_PAGES` lines (`parseChannelLine`) with only the host
changed; SSE `approval` / `approval-withdrawn` (fields only added: `nonce`); the helper's one-line `allow|deny|ask`
stdout; `$.store` keys `pageApprovals`, `languageAsked`; 0.7.x servers joining a 0.8.0 hub and the reverse
(`/hub/*` routes keep their names; an old hub without the new fields yields `ask`).

## 4. States

Approval card (PAGE): **loading** (SSE connecting: "Connecting..."); **empty** (no ask: nothing shown, inbox as today);
**waiting** (agent, tool, exact input, countdown, Allow with a Touch ID icon, Deny, Ask in terminal); **touching**
(system sheet open; buttons disabled); **error** (assertion failed or signature rejected: "Not verified, answer in the
terminal", the dialog follows); **timeout** ("Time is up, asked in the terminal"); **denied** (confirmation, card
closes); **allowed** (confirmation); **withdrawn** (the ask ended elsewhere); **no WebAuthn** (Allow absent, reason
shown, Deny and terminal remain); **busy** (second ask goes to the dialog, no card).
Registration screen: **loading**; **empty/no key** (code field, Register); **registering** (system sheet);
**wrong code** (tries left); **code expired** (ask the person to rerun `/hq web approvals on`); **error** (ceremony
failed or cancelled, retry); **registered** (key shown by a short fingerprint, also in the toast); **no WebAuthn**
(explains; approvals stay in the terminal); **logged out** (the existing "open the page again with /hq web").
All strings in `hooks/i18n.ts` (toasts, replies) and `web/i18n.js` (page), English and Thai.

## 5. Acceptance criteria

- AC1 Given approvals on and a registered key, when the person taps Allow and completes Touch ID, then the ask is
  allowed with `ALLOWED` and the tool runs.
- AC2 Given a held ask, when the person taps Deny, then the ask is denied with `DENIED`, no touch asked.
- AC3 Given a held ask, when 60 s pass, esc is pressed or "Ask in terminal now" is tapped, then the verdict stays `ask`
  and the dialog follows, the card is withdrawn.
- AC4 Given no registered key, when an ask arrives, then no card is shown and the dialog asks; the page shows the
  registration screen.
- AC5 Given a browser without WebAuthn, when a card shows, then Allow is absent and only Deny / terminal work.
- AC6 (hub.json read) Given an agent reads hub.json and computes `HMAC(secret, "agent-hq session cookie")`, when it
  sends that cookie to the hub, then it gets 403 (the cookie is random per run).
- AC7 (login by `/hub/code`) Given an agent mints a code with the secret and logs in, when it reads `/events` for the
  token and posts `/approval/<id>` with `allow`, then the ask is not allowed: HELPER prints `ask` (no valid assertion).
- AC8 (forged headers) Given a script sets Origin, Host and Sec-Fetch-Site to the page's values, when it posts an
  `allow` without a valid assertion, or with one signed by another key or for another challenge, then HELPER prints
  `ask` and nothing is allowed.
- AC9 (forged card) Given an agent posts `/hub/approval` with a made-up card, when anyone answers it, then no real ask
  resolves and no allow reaches MOD; given it holds the single slot, then the next real ask goes to the dialog at once.
- AC10 (fake session) Given an agent registers a session via `/hub/register`, when it answers cards for it, then no
  allow is produced for any real ask.
- AC11 (software-key registration) Given an agent completes the ceremony with a key it made, when it posts
  `/register-passkey` without the code, or with a wrong code three times, then MOD stores no key and the code is burnt.
- AC12 (key swap) Given an agent edits `$.store`, hub.json, the state file or the queue file, when an ask is held,
  then HELPER still verifies against the key MOD passed on stdin; no file edit changes the key.
- AC13 (code secrecy) Given a registration code was minted, when the agent reads the transcript, the reply, the state
  file, the queue file, the debug log and `pages.json`, then the code appears in none.
- AC14 (direct helper) Given an agent runs `node web/approve.mjs` itself, when it prints, then it never prints `allow`
  without a valid assertion over a MOD-supplied challenge and key.
- AC15 (altered card) Given the hub or page changes the tool or input shown, when the person touches Allow, then the
  signature does not match MOD's challenge and HELPER prints `ask`.
- AC16 (replay) Given a valid assertion for an earlier ask, when it is posted for another id or nonce, or again, then it
  is refused.
- AC17 (store flag) Given an agent sets `pageApprovals` true in the store file, when no key is registered, then nothing
  is held; given it sets it false, then asks go to the dialog.
- AC18 (turn on) Given a plugin, schedule or other-session run, when it sends `/hq web approvals on`, then it is
  refused (`approvals.notYours`); an unattested run is asked first with No first, as today.
- AC19 (links) Given approvals are on, when `/hq web` runs, then the reply carries no login link (toast only), as today.
- AC20 (test bug 1) Given the wiring test "an ask a host answers" is removed, then `tests/page-approval.test.ts` has a
  `canHold` row with `decider: 'host'` that is not held, and `claude plugin test .` has no failure for it.
- AC21 (test bug 2) Given the "cannot attest" wiring test sets `s.box.verdict = { decision: 'allow' }` after `boot`,
  then it passes (answers "No", dismissed, "Yes, turn them on").
- AC22 (compat) Given a 0.7.x session server joins a 0.8.0 hub, when it registers and forwards, then it works and
  `hub.json`, `pages.json` and the state files parse as before.
- AC23 (strings) Given `en` and `th` tables, when the i18n test runs, then both have every new key with the same
  placeholders.

## 6. Project rules

| Rule | Check |
|---|---|
| Types | `npx -p typescript@5.6.3 tsc -p . --noUnusedLocals` clean (README) |
| Tests | `claude plugin test .` and `node --test web/server.test.mjs` (hub, approvals, helper tests: `web/approve.test.mjs`) green; new tests: signature verify (valid, wrong key, wrong challenge, wrong origin, replay, UP/UV missing), registration code, each AC above |
| Mod valid | `claude plugin validate .` |
| Thai and English | every string in `hooks/i18n.ts` and `web/i18n.js`; `tests/i18n.test.ts` parity |
| README | its list of commands / capabilities names the passkey registration and Touch ID approval |
| CHANGELOG | a 0.8.0 entry (Added, Changed: URL host `localhost`, cookie no longer survives a hub takeover) |
| Version | `.claude-plugin/plugin.json` and `marketplace.json` to 0.8.0 at release |
| Size | no new dependency; keep files under 800 lines (`web/server.test.mjs` is already a test exception) |

## 7. Risks

- This is authentication: a security review by the review role is required twice, on this spec before building and on
  the finished diff before merge; no merge without it (QA writes the attack tests AC6-AC17 as scripts against a real hub).
- `localhost` may resolve to `::1` first while the hub listens on 127.0.0.1 only: browsers fall back, but test it; do not
  widen the listener without review.
- rpId `localhost` is shared by every localhost site; a credential is per rpId, so another local page can ask for a
  touch but cannot produce a signature over our challenge.
- A forged card can still show the person false text and cost a pointless touch, and an agent with a login can deny
  real asks; both fail safe (no allow).
- Per-session registration costs one touch and a code every session; on the safe side by design.
- Hand-written clientDataJSON / authData parsing: use fixtures from a real browser, reject on any unexpected field.

## 8. Out of scope

Other OS users, other devices and malware outside Claude (the person's answers). Also: remote or phone approval,
password / code fallbacks, hardware keys other than the platform authenticator, persisting the key across sessions,
approving from the terminal dialog itself.

## 9. Open questions for the person

1. A logged-in agent (via the secret) can still use `/action` (message the lead, start or stop agents). Accept in 0.8.0
   (approvals are what the threat is about), or make `/action` also need a touch?
2. Register a key every session (safe, as specified), or persist it in `$.store` guarded by a fingerprint you confirm
   at session start (convenient, but a swapped key is only caught if you look)?
3. Deny without a touch (as specified), or require the touch for both?
4. Moving the page to `localhost` logs your browser out once and changes the printed link: acceptable?
5. A Mac without Touch ID (password-only prompt) still satisfies "user verification": acceptable, or Touch ID only?
