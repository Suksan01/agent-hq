// Which team files are trusted: SHA-256 of the content, per path.
import { expect, test } from 'claude-code/testing'

import { approvalsFrom, hasOldRecord, isApproved, sha256Hex, withApproval } from '../hooks/approval'

test('sha256Hex matches the standard test vectors, across block boundaries and for non-ASCII text', () => {
  expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  expect(sha256Hex('héllo wörld ✓ 😀')).toBe('23e0a0c5e66366c058e29407717008da83f9004340e71ff074bb24bd4b80eb2a')
  // the padding edges: 55, 56 and 64 bytes
  expect(sha256Hex('x'.repeat(55))).toBe('d5e285683cd4efc02d021a5c62014694958901005d6f71e89e0989fac77e4072')
  expect(sha256Hex('x'.repeat(56))).toBe('04c26261370ee7541549d16dee320c723e3fd14671e66a099afe0a377c16888e')
  expect(sha256Hex('x'.repeat(64))).toBe('7ce100971f64e7001e8fe5a51973ecdfe1ced42befe7ee8d5fd6219506b5393c')
})

test('a file is trusted only at the text that was trusted', () => {
  const list = withApproval([], '/work/app/.claude/agent-hq/team.json', 'v1')

  expect(isApproved(list, '/work/app/.claude/agent-hq/team.json', 'v1')).toBe(true)
  expect(isApproved(list, '/work/app/.claude/agent-hq/team.json', 'v1 edited')).toBe(false)
  expect(isApproved(list, '/work/app/.claude/agent-hq/team.json', 'v1 ')).toBe(false)
  expect(isApproved(list, '/other/.claude/agent-hq/team.json', 'v1')).toBe(false)
  expect(list[0]?.sha256).toMatch(/^[0-9a-f]{64}$/)
})

test('trusting the same path again replaces its old record and keeps the others', () => {
  let list = withApproval([], '/a', 'one')
  list = withApproval(list, '/b', 'two')
  list = withApproval(list, '/a', 'one-edited')

  expect(list.map(a => a.path)).toEqual(['/b', '/a'])
  expect(isApproved(list, '/a', 'one')).toBe(false)
  expect(isApproved(list, '/a', 'one-edited')).toBe(true)
  expect(isApproved(list, '/b', 'two')).toBe(true)
})

test('records from an older version (a short hash) never match, are recognised for a clear message, and are dropped by the next trust', () => {
  const old = [{ path: '/a', hash: '1f3a9c0b2d4e5' }, { path: '/b', hash: 'abc' }]

  expect(approvalsFrom(old)).toEqual([])
  expect(isApproved(old, '/a', 'anything')).toBe(false)
  expect(hasOldRecord(old, '/a')).toBe(true)
  expect(hasOldRecord(old, '/zzz')).toBe(false)
  expect(hasOldRecord(withApproval(old, '/a', 'x'), '/a')).toBe(false) // trusted again: the new record stands
  expect(approvalsFrom(withApproval(old, '/a', 'x')).map(a => a.path)).toEqual(['/a'])
})

test('the stored list is read as untrusted and is capped', () => {
  expect(approvalsFrom(undefined)).toEqual([])
  expect(approvalsFrom('x')).toEqual([])
  expect(approvalsFrom([null, 5, { path: 1, sha256: 'h' }, { path: '/a' }, { path: '/short', sha256: 'abc' }, { path: '/ok', sha256: sha256Hex('x') }])).toEqual([{ path: '/ok', sha256: sha256Hex('x') }])
  let list: unknown = []
  for (let i = 0; i < 80; i++) list = withApproval(list, `/p${i}`, 'x')
  expect(approvalsFrom(list)).toHaveLength(50)
  expect(isApproved(list, '/p79', 'x')).toBe(true)
  expect(isApproved(list, '/p0', 'x')).toBe(false)
})
