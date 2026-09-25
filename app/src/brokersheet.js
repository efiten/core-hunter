// The "MQTT brokers" page inside the settings sheet (#554): every broker a
// reception goes to, a switch per broker, and a form to add one. DOM glue only;
// what a row says and whether a form is valid are brokers.js decisions, and
// storing, probing and connecting are the caller's.
import { brokerStatus } from './brokers.js'

const BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>'

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function host(url) {
  try { return new URL(url).host } catch (_) { return url }
}

function node(tag, className, text) {
  const n = document.createElement(tag)
  if (className) n.className = className
  if (text != null) n.textContent = text
  return n
}

// createBrokerSheet wires the page into `root`.
//   getBrokers()            the merged list: [{ id, name, url, source, enabled, username }]
//   getStatus(id)           Promise<{ connected, queued, needsCompanion }>
//   onToggle(id, enabled)   the hunter flipped a switch
//   onSave(form, editingId) Promise<{ ok, errors }>; validates, connects, stores
//   onRemove(id)            the hunter removed a broker they added
// `presets` are the brokers the add form can start from (presetsFrom in
// brokers.js, out of config.json); with none the "Start from" row is not shown.
export function createBrokerSheet({ root, getBrokers, getStatus, onToggle, onSave, onRemove, presets = [] }) {
  root.innerHTML = `
    <div class="bk-view" id="bk-list-view">
      <div class="sheet-head bk-head">
        <button type="button" class="bk-back" id="bk-back" aria-label="Back to status">${BACK}</button>
        <h2 class="bk-title">MQTT brokers</h2>
      </div>
      <div class="ss-panel active">
        <p class="ss-hint bk-lead">Every reception goes to each broker that is on. A broker that is offline catches up later.</p>
        <div class="ss-grp bk-rows" id="bk-rows"></div>
        <button type="button" class="bk-add" id="bk-add">Add broker</button>
        <p class="ss-hint">Tap a broker you added to edit or remove it. Brokers from this site can only be switched off.</p>
      </div>
    </div>
    <div class="bk-view" id="bk-form-view" hidden>
      <div class="sheet-head bk-head">
        <button type="button" class="bk-back" id="bk-form-back" aria-label="Back to brokers">${BACK}</button>
        <h2 class="bk-title" id="bk-form-title">Add broker</h2>
      </div>
      <form class="ss-panel active bk-form" id="bk-form" novalidate>
        <div class="bk-field" id="bk-presets-field"${presets.length ? '' : ' hidden'}><span>Start from</span>
          <div class="bk-chips" id="bk-presets">
            ${presets.map((p) => `<button type="button" class="bk-chip" data-preset="${esc(p.key)}" aria-pressed="false">${esc(p.name)}</button>`).join('')}
            <button type="button" class="bk-chip" data-preset="" aria-pressed="true">Custom</button>
          </div>
        </div>
        <label class="bk-field"><span>Name</span><input id="bk-name" type="text" autocomplete="off" placeholder="Shown in this list" /></label>
        <label class="bk-field"><span>Address</span><input id="bk-url" type="url" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="wss://broker.example:443" /></label>
        <p class="bk-error" id="bk-url-error" role="alert" hidden></p>
        <div class="bk-field"><span id="bk-auth-label">Sign in with</span>
          <div class="ss-seg bk-seg" role="group" aria-labelledby="bk-auth-label">
            <button type="button" id="bk-auth-password" aria-pressed="true">Password</button>
            <button type="button" id="bk-auth-companion" aria-pressed="false">Companion key</button>
          </div>
        </div>
        <p class="ss-hint" id="bk-auth-hint" hidden>Your companion signs you in with its own key. The key stays on the radio, and the broker sees which companion you are.</p>
        <div class="bk-pair" id="bk-pair">
          <label class="bk-field"><span>Username</span><input id="bk-user" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" /></label>
          <label class="bk-field"><span>Password</span><input id="bk-pass" type="password" autocomplete="off" /></label>
        </div>
        <p class="ss-hint" id="bk-format-hint"></p>
        <details class="bk-adv">
          <summary>Advanced</summary>
          <div class="bk-field"><span id="bk-format-label">Send as</span>
            <div class="ss-seg bk-seg" role="group" aria-labelledby="bk-format-label">
              <button type="button" id="bk-format-wardrive" aria-pressed="true">Wardrive</button>
              <button type="button" id="bk-format-packets" aria-pressed="false">Packets</button>
            </div>
          </div>
          <p class="ss-hint">Wardrive: receptions plus your track, for a hunter map. Packets: one message per reception, for a Mesh-Hunter server.</p>
        </details>
        <button type="button" class="bk-remove" id="bk-remove" hidden>Remove broker</button>
        <button type="submit" class="ss-connect bk-save" id="bk-save">Connect and save</button>
      </form>
    </div>`

  const $ = (id) => root.querySelector('#' + id)
  let editingId = null
  // One status updater per drawn row, so the render tick can keep the lines
  // honest without rebuilding rows under a finger.
  let updaters = []

  let auth = 'password'
  function setAuth(next) {
    auth = next
    $('bk-auth-password').setAttribute('aria-pressed', String(auth === 'password'))
    $('bk-auth-companion').setAttribute('aria-pressed', String(auth === 'companion'))
    $('bk-pair').hidden = auth === 'companion'
    $('bk-auth-hint').hidden = auth !== 'companion'
  }

  let format = 'wardrive'
  function setFormat(next) {
    format = next
    $('bk-format-wardrive').setAttribute('aria-pressed', String(format === 'wardrive'))
    $('bk-format-packets').setAttribute('aria-pressed', String(format === 'packets'))
    $('bk-format-hint').textContent = format === 'wardrive'
      ? "Sends each reception with your position, plus your track. The broker's owner can see where you drove."
      : "Sends each reception with your position. The broker's owner can see where you drove."
  }

  // The stream label a preset's broker acknowledges rides with the saved
  // broker; a custom broker has none and publishes on the default.
  let presetLabel = null
  function setPreset(key) {
    for (const chip of root.querySelectorAll('.bk-chip')) chip.setAttribute('aria-pressed', String(chip.dataset.preset === key))
    const preset = presets.find((p) => p.key === key)
    presetLabel = preset ? preset.label : null
    if (!preset) return
    $('bk-name').value = preset.name
    $('bk-url').value = preset.url
    setAuth(preset.auth === 'companion' ? 'companion' : 'password')
    setFormat(preset.format === 'wardrive' ? 'wardrive' : 'packets')
  }

  function showView(which) {
    $('bk-list-view').hidden = which !== 'list'
    $('bk-form-view').hidden = which !== 'form'
  }

  function openForm(broker) {
    editingId = broker ? broker.id : null
    $('bk-form-title').textContent = broker ? 'Edit broker' : 'Add broker'
    $('bk-name').value = broker ? broker.name : ''
    $('bk-url').value = broker ? broker.url : ''
    // The address is what a broker's progress is stored under, so an added
    // broker keeps it; a different address is a different broker.
    $('bk-url').readOnly = Boolean(broker)
    $('bk-user').value = broker ? (broker.username || '') : ''
    $('bk-pass').value = broker ? (broker.password || '') : ''
    setAuth(broker && broker.auth === 'companion' ? 'companion' : 'password')
    setFormat(broker && broker.format !== 'wardrive' ? 'packets' : 'wardrive')
    // A preset is a way to fill in a new broker, not a property of a saved one.
    $('bk-presets-field').hidden = Boolean(broker) || !presets.length
    setPreset('')
    presetLabel = broker ? (broker.label || null) : null
    root.querySelector('.bk-adv').open = false
    $('bk-remove').hidden = !broker
    $('bk-url-error').hidden = true
    $('bk-save').disabled = false
    $('bk-save').textContent = 'Connect and save'
    showView('form')
  }

  async function refresh() {
    const rows = $('bk-rows')
    const brokers = getBrokers()
    updaters = []
    rows.replaceChildren(...brokers.map((b) => {
      const row = node('div', 'bk-row')
      row.dataset.id = b.id
      const dot = node('i', 'ss-state-dot bk-dot')
      const txt = node('div', 'bk-txt')
      txt.append(node('span', 'bk-name', b.name), node('span', 'bk-host', host(b.url)))
      const status = node('span', 'bk-status', (b.source === 'site' ? 'From this site' : 'Added by you'))
      txt.append(status)
      if (b.auth === 'companion') txt.append(node('span', 'bk-status', "Signs in with your companion's key"))
      if (b.source === 'user') {
        txt.classList.add('bk-tappable')
        txt.tabIndex = 0
        txt.setAttribute('role', 'button')
        txt.setAttribute('aria-label', 'Edit ' + b.name)
        txt.addEventListener('click', () => openForm(b))
      }
      const sw = node('button', 'bk-switch')
      sw.type = 'button'
      sw.setAttribute('role', 'switch')
      sw.setAttribute('aria-checked', String(b.enabled))
      sw.setAttribute('aria-label', 'Send receptions to ' + b.name)
      sw.append(node('span', 'bk-switch-track'))
      sw.addEventListener('click', async () => { await onToggle(b.id, !b.enabled); refresh() })
      row.append(dot, txt, sw)
      const update = () => getStatus(b.id).then((s) => {
        const view = brokerStatus({ enabled: b.enabled, ...s })
        dot.classList.toggle('on', view.dot === 'on')
        dot.classList.toggle('warn', view.dot === 'warn')
        status.textContent = (b.source === 'site' ? 'From this site' : 'Added by you') + ' · ' + view.text
      }).catch(() => {})
      updaters.push(update)
      update()
      return row
    }))
  }

  $('bk-add').addEventListener('click', () => openForm(null))
  for (const chip of root.querySelectorAll('.bk-chip')) chip.addEventListener('click', () => setPreset(chip.dataset.preset))
  $('bk-format-wardrive').addEventListener('click', () => setFormat('wardrive'))
  $('bk-format-packets').addEventListener('click', () => setFormat('packets'))
  $('bk-auth-password').addEventListener('click', () => setAuth('password'))
  $('bk-auth-companion').addEventListener('click', () => setAuth('companion'))
  $('bk-form-back').addEventListener('click', () => showView('list'))
  $('bk-back').addEventListener('click', () => { root.hidden = true })
  $('bk-remove').addEventListener('click', async () => {
    await onRemove(editingId)
    showView('list')
    refresh()
  })
  $('bk-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const save = $('bk-save')
    save.disabled = true
    save.textContent = 'Connecting…'
    const result = await onSave({
      name: $('bk-name').value, url: $('bk-url').value, auth, format, username: $('bk-user').value, password: $('bk-pass').value, label: presetLabel,
    }, editingId)
    save.disabled = false
    save.textContent = 'Connect and save'
    const err = $('bk-url-error')
    err.hidden = result.ok
    err.textContent = result.ok ? '' : (result.errors.url || 'Could not save this broker.')
    if (result.ok) { showView('list'); refresh() }
  })

  return {
    open() { root.hidden = false; showView('list'); refresh() },
    close() { root.hidden = true },
    // Called from the render tick: statuses only.
    tick() { if (!root.hidden && !$('bk-list-view').hidden) updaters.forEach((u) => u()) },
  }
}
