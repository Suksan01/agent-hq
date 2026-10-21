// Every word the live page writes itself, in English and Thai. The page speaks the language of its sessions' snapshots
// (`lang`, set by the mod from the person's choice; the first live session decides when two differ). Pure, no DOM, so
// `node --test` checks that both tables have the same keys and placeholders. The Thai follows the approved glossary
// (side-session notes, hq-0.6.0-thai-glossary.md): เอเจนต์, หัวหน้า, agents counted with คน, no ครับ/ค่ะ, no ผม/ฉัน.
// What the mod and the agents write (names, tool lines, sentences, bubbles, feed text) comes already in its language.

export const STRINGS = {
  en: {
    'status.working': 'Working', 'status.waiting': 'Needs you', 'status.done': 'Done', 'status.failed': 'Failed', 'status.idle': 'Idle', 'status.stopped': 'Stopped', 'status.lead': 'Lead',
    'crew.waiting': 'Waiting', 'lead.allDone': 'All done', 'lead.failure': 'Failure in team',
    'orb.thinking': 'Thinking', 'card.now': 'Now', 'card.next': 'Next', team: 'Team',
    'chips.label': 'Systems', 'toolbar.label': 'Tools', 'menu.label': 'Actions', send: 'Send', close: 'Close',
    'drawer.level': 'Level', 'drawer.timeline': 'Timeline', 'drawer.finished': 'This agent has finished; nothing to send or stop.',
    'drawer.messageTo': 'Message {name}…', 'drawer.stopAsk': 'Stop {name}?', 'drawer.stopWarn': 'Stop {name}? Work in progress is lost.',
    'drawer.keep': 'Keep', 'drawer.stop': 'Stop', 'drawer.stopAgent': 'Stop agent',
    'stat.tools': 'Tools', 'stat.time': 'Time', 'stat.last': 'Last',
    'feed.title': 'Activity', 'feed.fold': 'Fold {title}', 'feed.open': 'Open {title}', 'feed.quiet': 'Quiet for now.',
    'feed.caughtUpOne': '… caught up {n} event', 'feed.caughtUp': '… caught up {n} events', 'feed.tooOld': '({n} too old to show)',
    'inbox.empty': 'Nothing needs you. The crew is on it.', 'inbox.waitingFor': 'Waiting for', 'inbox.waiting': 'waiting', 'inbox.message': 'Message',
    'inbox.terminal': 'Answer it in the terminal', 'inbox.needsApproval': 'Needs approval', 'toast.dismiss': 'Dismiss',
    'add.title': 'Add an agent', 'add.cancel': 'Cancel', 'add.hire': 'Hire another', 'add.add': 'Add agent', 'add.role': 'Role',
    'add.full': '{title}: all {count} at work', 'add.room': '{active} of {count} at work', 'add.noRoles': 'No team roles: use Hire another to ask the lead.',
    'add.task': 'Task', 'add.taskHint': 'What should it do?', 'add.hireHint': 'Hire another asks the lead to bring one on',
    'board.title': 'Task board', 'board.close': 'Close the task board', 'board.empty': 'No board tasks yet.', 'board.waitsOn': 'waits on {ids}',
    'lead.title': 'Tech Lead', 'lead.crew': 'Crew', 'lead.more': '{n} more', 'lead.moreList': '+{n} more · {words}',
    'lead.message': 'Message lead', 'lead.messageLabel': 'Message the lead', 'lead.tasks': 'Tasks', 'lead.tasksLabel': 'Open the task board', 'lead.actions': 'Lead actions',
    'lead.board': 'Mission board', 'lead.steps': 'steps', 'lead.plan': 'Plan', 'lead.noPlan': 'No plan yet.', 'lead.noCrew': 'No crew yet.',
    'lead.needsOne': '{n} needs you', 'lead.needsMany': '{n} need you', 'lead.of': '{title} of {team}',
    'step.done': 'done', 'step.now': 'now', 'step.next': 'next',
    'live.on': 'live', 'live.lost': 'lost its login: run /hq web again', 'live.reconnecting': 'reconnecting',
    'live.connecting': 'Connecting to Agent HQ…', 'live.moment': 'One moment.', 'live.none': 'No Claude Code session is running',
    'live.start': 'Start one, then run /hq web in it.', 'live.lostPage': 'This page lost its login: run /hq web again.', 'live.noSession': 'No session is running',
    'live.teamToMessage': 'Team to message', 'live.hide': 'Hide', 'live.hideFeed': 'Hide the activity feed',
    'live.boardHide': 'Hide the task board', 'live.boardShow': 'Show the task board', 'live.showDone': 'Show done agents', 'live.hideDone': 'Hide done agents',
    'live.clearDone': 'Clear done agents and tasks', 'live.fit': 'Fit everything', 'live.fullScreen': 'Full screen', 'live.soundsOn': 'Sounds on', 'live.soundsOff': 'Sounds off',
    'live.noRole': 'This team has no role to start an agent with', 'live.clearTitle': 'Clear done?', 'live.keepThem': 'Keep them', 'live.clear': 'Clear',
    'live.clearText': 'Finished agents and completed tasks leave the page (and the sidebar). Running work stays.', 'live.all': 'All',
    'hud.systems': '{n} systems',
    'post.sent': 'Sent to Agent HQ…', 'post.stopped': '{where}that session has stopped', 'post.unreachable': '{where}could not reach the session',
    'post.busy': '{where}too many requests are waiting; try again shortly', 'post.offline': 'Could not reach Agent HQ',
    'view.label': 'View', 'view.diagram': 'Diagram', 'view.space': 'Space', 'view.lost': 'Space view stopped: the browser turned WebGL off',
    'space.unavailableTitle': 'Space view unavailable',
    'space.unavailable': "The Space view needs WebGL, which this browser has turned off. Quit and reopen Chrome, or turn on 'Use graphics acceleration' in chrome://settings/system.",
    'space.noWebgl': 'WebGL is not available in this browser, so the space view cannot be drawn', 'space.loading': 'loading the space view…',
    'badge.first_task': 'First Task', 'badge.ten_tools': 'Getting Handy', 'badge.hundred_tools': 'Toolbelt Titan', 'badge.test_streak_5': 'Green Streak',
    'badge.bug_squasher': 'Bug Squasher', 'badge.reviewer_eagle': 'Reviewer Eagle', 'badge.speedy': 'Speedy', 'badge.comeback': 'Comeback',
    'talk.lead': 'Lead', 'talk.to': 'to {who}', 'talk.from': 'from {who}',
    'next.title': 'Next steps', 'next.list': 'Suggested by the lead', 'next.use': 'Draft in Message lead: {text}', 'next.notNow': 'Not now',
    'approval.title': 'Needs your approval', 'approval.wants': '{agent} wants to use {tool}', 'approval.input': 'The exact input',
    'approval.hidden': 'Hidden characters are shown as ⟦U+…⟧', 'approval.left': '{n}s left', 'approval.allow': 'Allow', 'approval.deny': 'Deny',
    'approval.terminal': 'Ask in terminal now', 'approval.gone': 'That approval was already answered or withdrawn',
    'approval.failed': 'Could not send your answer: try again, or answer in the terminal',
    'approval.because': 'Claude Code asks because: {reason}', 'approval.setting': 'setting {name}', 'approval.hook': 'hook {name}',
    'unit.s': '{n}s', 'unit.m': '{n}m', 'unit.h': '{n}h',
  },
  th: {
    'status.working': 'ทำงานอยู่', 'status.waiting': 'รอคุณ', 'status.done': 'เสร็จแล้ว', 'status.failed': 'ล้มเหลว', 'status.idle': 'ว่าง', 'status.stopped': 'หยุดแล้ว', 'status.lead': 'หัวหน้าทีม',
    'crew.waiting': 'รอคุณ', 'lead.allDone': 'เสร็จครบแล้ว', 'lead.failure': 'มีงานล้มเหลวในทีม',
    'orb.thinking': 'กำลังคิด', 'card.now': 'ตอนนี้', 'card.next': 'ถัดไป', team: 'ทีม',
    'chips.label': 'ระบบ', 'toolbar.label': 'เครื่องมือ', 'menu.label': 'คำสั่ง', send: 'ส่ง', close: 'ปิด',
    'drawer.level': 'เลเวล', 'drawer.timeline': 'ลำดับเหตุการณ์', 'drawer.finished': 'เอเจนต์นี้ทำงานเสร็จแล้ว ไม่มีอะไรให้ส่งหรือหยุด',
    'drawer.messageTo': 'ส่งข้อความถึง {name}…', 'drawer.stopAsk': 'หยุด {name} ใช่ไหม', 'drawer.stopWarn': 'หยุด {name} ใช่ไหม งานที่ทำค้างไว้จะหายไป',
    'drawer.keep': 'ให้ทำต่อ', 'drawer.stop': 'หยุด', 'drawer.stopAgent': 'หยุดเอเจนต์',
    'stat.tools': 'เครื่องมือ', 'stat.time': 'เวลา', 'stat.last': 'ล่าสุด',
    'feed.title': 'กิจกรรม', 'feed.fold': 'ย่อ{title}', 'feed.open': 'เปิด{title}', 'feed.quiet': 'ยังเงียบอยู่',
    'feed.caughtUpOne': '… ตามทัน {n} เหตุการณ์', 'feed.caughtUp': '… ตามทัน {n} เหตุการณ์', 'feed.tooOld': '({n} รายการเก่าเกินจะแสดง)',
    'inbox.empty': 'ไม่มีอะไรรอคุณ ทีมจัดการอยู่', 'inbox.waitingFor': 'รอมาแล้ว', 'inbox.waiting': 'รอ', 'inbox.message': 'ส่งข้อความ',
    'inbox.terminal': 'ตอบในเทอร์มินัล', 'inbox.needsApproval': 'รออนุมัติ', 'toast.dismiss': 'ปิดแจ้งเตือน',
    'add.title': 'เพิ่มเอเจนต์', 'add.cancel': 'ยกเลิก', 'add.hire': 'ขอเพิ่มอีกคน', 'add.add': 'เพิ่มเอเจนต์', 'add.role': 'บทบาท',
    'add.full': '{title}: ทำงานครบ {count} คนแล้ว', 'add.room': 'ทำงานอยู่ {active} จาก {count}', 'add.noRoles': 'ทีมนี้ไม่มีบทบาท ใช้ "ขอเพิ่มอีกคน" เพื่อขอจากหัวหน้า',
    'add.task': 'งาน', 'add.taskHint': 'ให้ทำอะไร', 'add.hireHint': '"ขอเพิ่มอีกคน" จะขอให้หัวหน้าหาเพิ่มอีกคน',
    'board.title': 'บอร์ดงาน', 'board.close': 'ปิดบอร์ดงาน', 'board.empty': 'ยังไม่มีงานบนบอร์ด', 'board.waitsOn': 'รอ {ids}',
    'lead.title': 'หัวหน้าทีมเทคนิค', 'lead.crew': 'สมาชิก', 'lead.more': 'อีก {n} คน', 'lead.moreList': '+อีก {n} คน · {words}',
    'lead.message': 'คุยกับหัวหน้า', 'lead.messageLabel': 'คุยกับหัวหน้า', 'lead.tasks': 'งาน', 'lead.tasksLabel': 'เปิดบอร์ดงาน', 'lead.actions': 'คำสั่งของหัวหน้า',
    'lead.board': 'บอร์ดภารกิจ', 'lead.steps': 'ขั้นตอน', 'lead.plan': 'แผน', 'lead.noPlan': 'ยังไม่มีแผน', 'lead.noCrew': 'ยังไม่มีสมาชิก',
    'lead.needsOne': '{n} คนรอคุณ', 'lead.needsMany': '{n} คนรอคุณ', 'lead.of': '{title} ของ {team}',
    'step.done': 'เสร็จแล้ว', 'step.now': 'กำลังทำ', 'step.next': 'ถัดไป',
    'live.on': 'ออนไลน์', 'live.lost': 'หลุดจากระบบ: รัน /hq web อีกครั้ง', 'live.reconnecting': 'กำลังเชื่อมต่อใหม่',
    'live.connecting': 'กำลังเชื่อมต่อกับ Agent HQ…', 'live.moment': 'รอสักครู่', 'live.none': 'ไม่มีเซสชัน Claude Code ที่ทำงานอยู่',
    'live.start': 'เปิดเซสชันใหม่ แล้วรัน /hq web ในนั้น', 'live.lostPage': 'หน้านี้หลุดจากระบบ: รัน /hq web อีกครั้ง', 'live.noSession': 'ไม่มีเซสชันที่ทำงานอยู่',
    'live.teamToMessage': 'ทีมที่จะคุยด้วย', 'live.hide': 'ซ่อน', 'live.hideFeed': 'ซ่อนกิจกรรม',
    'live.boardHide': 'ซ่อนบอร์ดงาน', 'live.boardShow': 'แสดงบอร์ดงาน', 'live.showDone': 'แสดงที่เสร็จ', 'live.hideDone': 'ซ่อนที่เสร็จ',
    'live.clearDone': 'ล้างที่เสร็จ', 'live.fit': 'พอดีจอ', 'live.fullScreen': 'เต็มจอ', 'live.soundsOn': 'เสียง: เปิด', 'live.soundsOff': 'เสียง: ปิด',
    'live.noRole': 'ทีมนี้ไม่มีบทบาทให้เริ่มเอเจนต์', 'live.clearTitle': 'ล้างที่เสร็จใช่ไหม', 'live.keepThem': 'เก็บไว้', 'live.clear': 'ล้าง',
    'live.clearText': 'เอเจนต์และงานที่เสร็จแล้วจะหายไปจากหน้านี้ (และแถบข้าง) งานที่ทำอยู่ยังอยู่ครบ', 'live.all': 'ทั้งหมด',
    'hud.systems': '{n} ระบบ',
    'post.sent': 'ส่งถึง Agent HQ แล้ว…', 'post.stopped': '{where}เซสชันนั้นหยุดไปแล้ว', 'post.unreachable': '{where}ติดต่อเซสชันไม่ได้',
    'post.busy': '{where}มีคำขอรอคิวมากเกินไป ลองใหม่อีกสักครู่', 'post.offline': 'ติดต่อ Agent HQ ไม่ได้',
    'view.label': 'มุมมอง', 'view.diagram': 'แผนผัง', 'view.space': 'อวกาศ', 'view.lost': 'มุมมองอวกาศหยุดทำงาน: เบราว์เซอร์ปิด WebGL',
    'space.unavailableTitle': 'ใช้มุมมองอวกาศไม่ได้',
    'space.unavailable': "มุมมองอวกาศต้องใช้ WebGL ซึ่งเบราว์เซอร์นี้ปิดอยู่ ให้ปิดแล้วเปิด Chrome ใหม่ หรือเปิด 'Use graphics acceleration' ใน chrome://settings/system",
    'space.noWebgl': 'เบราว์เซอร์นี้ไม่มี WebGL จึงวาดมุมมองอวกาศไม่ได้', 'space.loading': 'กำลังโหลดมุมมองอวกาศ…',
    'badge.first_task': 'งานแรก', 'badge.ten_tools': 'เริ่มคล่องมือ', 'badge.hundred_tools': 'เจ้าแห่งเครื่องมือ', 'badge.test_streak_5': 'เทสต์ผ่านรวด',
    'badge.bug_squasher': 'นักปราบบั๊ก', 'badge.reviewer_eagle': 'ตาเหยี่ยวรีวิว', 'badge.speedy': 'ไวสุด', 'badge.comeback': 'กลับมาได้',
    'talk.lead': 'หัวหน้า', 'talk.to': 'ถึง {who}', 'talk.from': 'จาก {who}',
    'next.title': 'ขั้นตอนถัดไป', 'next.list': 'หัวหน้าแนะนำ', 'next.use': 'ร่างในช่องคุยกับหัวหน้า: {text}', 'next.notNow': 'ไว้ทีหลัง',
    'approval.title': 'รออนุมัติ', 'approval.wants': '{agent} ขอใช้ {tool}', 'approval.input': 'อินพุตทั้งหมดตามจริง',
    'approval.hidden': 'อักขระที่มองไม่เห็นแสดงเป็น ⟦U+…⟧', 'approval.left': 'เหลือ {n} วิ', 'approval.allow': 'อนุญาต', 'approval.deny': 'ไม่อนุญาต',
    'approval.terminal': 'ถามในเทอร์มินัลเลย', 'approval.gone': 'คำขอนี้ตอบไปแล้วหรือถูกถอนแล้ว',
    'approval.failed': 'ส่งคำตอบไม่ได้ ลองอีกครั้งหรือตอบในเทอร์มินัล',
    'approval.because': 'Claude Code ถามเพราะ: {reason}', 'approval.setting': 'การตั้งค่า {name}', 'approval.hook': 'ฮุก {name}',
    'unit.s': '{n} วิ', 'unit.m': '{n} นาที', 'unit.h': '{n} ชม.',
  },
}

let lang = 'en'

/** The page's language from here on: 'th', else English. */
export const setLang = next => { lang = next === 'th' ? 'th' : 'en' }
export const getLang = () => lang

/** Whether the table has `key` (the page's words for an open set, like statuses, fall back to the raw value otherwise). */
export const has = key => Object.hasOwn(STRINGS.en, key)

/** A string of the page in its language, `{name}` holes filled from `params`; a key with no text is shown as itself. */
export const t = (key, params = {}) => (STRINGS[lang][key] ?? STRINGS.en[key] ?? key).replace(/\{(\w+)\}/g, (hole, name) => (params[name] ?? hole))

/** The language the sessions ask for: the first live one's (the page lists them in a stable order); undefined with none. */
export function langOf(sessions) {
  const first = sessions.find(s => s.alive) ?? sessions[0]
  if (!first) return undefined
  return first.snapshot?.lang === 'th' ? 'th' : 'en'
}
