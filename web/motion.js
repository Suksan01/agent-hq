// A motion budget for the space theme: nothing animates that nobody can see. `pauseOffscreen` marks every animated kit element
// that is scrolled out of view with `.is-offscreen` (space.css then pauses its animations) and marks a hidden tab with
// `html.is-hidden`. It watches the page as it changes, so cards that appear later are covered too. One IntersectionObserver for
// the lot; call it once per page and keep the returned `dispose`.

// everything in the kit that moves while it works (blobs, planets, the border beam, the thinking orb, progress, links, toasts)
const WATCHED = '.sk-blob, .sk-planet, .sk-planet-pulse, .sk-agent, .sk-beam, .sk-orb, .sk-bar, .sk-links, .sk-toast, .sk-empty__orbit, .sk-stars'

/** Starts watching `root`; returns a function that stops. Without IntersectionObserver nothing is paused (and nothing breaks). */
export function pauseOffscreen(root = document.body, { margin = '240px 0px' } = {}) {
  const doc = root.ownerDocument
  const onVisibility = () => doc.documentElement.classList.toggle('is-hidden', doc.hidden)
  doc.addEventListener('visibilitychange', onVisibility)
  onVisibility()
  if (typeof IntersectionObserver !== 'function' || typeof MutationObserver !== 'function') return () => doc.removeEventListener('visibilitychange', onVisibility)

  const seen = new WeakSet()
  const watcher = new IntersectionObserver(entries => {
    for (const entry of entries) entry.target.classList.toggle('is-offscreen', !entry.isIntersecting)
  }, { rootMargin: margin })
  const watch = el => {
    if (seen.has(el)) return
    seen.add(el)
    watcher.observe(el)
  }
  const scan = node => {
    if (node.nodeType !== 1) return
    if (node.matches(WATCHED)) watch(node)
    for (const el of node.querySelectorAll(WATCHED)) watch(el)
  }
  scan(root)
  const mutations = new MutationObserver(list => {
    for (const record of list) for (const node of record.addedNodes) scan(node)
  })
  mutations.observe(root, { childList: true, subtree: true })
  return () => {
    watcher.disconnect()
    mutations.disconnect()
    doc.removeEventListener('visibilitychange', onVisibility)
  }
}
