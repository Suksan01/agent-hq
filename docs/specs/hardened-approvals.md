# Hardened page approvals (0.8.0)

Status: brainstorm (approved)

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
