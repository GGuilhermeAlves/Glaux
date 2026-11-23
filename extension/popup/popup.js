// Glaux — popup
const api = globalThis.browser ?? globalThis.chrome;
const DEFAULTS = {
  enabled: true, autoOn: false, sharpness: 60, denoise: true,
  showButton: true, maxOutput: 3840, disabledSites: [], glassPopup: true
};
const $ = (id) => document.getElementById(id);
const t = (k, subs) => api.i18n.getMessage(k, subs) || k;
let settings = { ...DEFAULTS };
let tab = null, host = '', anyActive = false, reachable = false;

// i18n
document.documentElement.lang = api.i18n.getUILanguage();
document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });

const save = (patch) => { Object.assign(settings, patch); api.storage.sync.set(patch); };

function setSegment(el, value) {
  const btns = [...el.querySelectorAll('button')];
  const i = btns.findIndex((b) => Number(b.dataset.v) === Number(value));
  btns.forEach((b, j) => b.classList.toggle('cur', j === i));
  el.classList.toggle('none', i < 0);
  if (i >= 0) el.style.setProperty('--i', i);
}

function paint() {
  document.body.classList.toggle('disabled', !settings.enabled);
  $('enabled').checked = settings.enabled;
  $('sharpness').value = settings.sharpness;
  $('sharpness').style.setProperty('--p', settings.sharpness + '%');
  $('sharpVal').textContent = settings.sharpness;
  setSegment($('presets'), settings.sharpness);
  setSegment($('maxOutput'), settings.maxOutput);
  $('denoise').checked = settings.denoise;
  $('autoOn').checked = settings.autoOn;
  $('showButton').checked = settings.showButton;
  $('glassPopup').checked = settings.glassPopup;
  $('siteOn').checked = !settings.disabledSites.includes(host);
  $('siteOn').disabled = !host;
  $('hostName').textContent = host;
}

function setStatus(kind, text, from, to) {
  $('status').innerHTML = '';
  $('status').append(text);
  $('dot').className = 'dot' + (kind === 'on' ? ' on' : kind === 'err' ? ' err' : '');
  $('res').hidden = !(from && to);
  if (from && to) { $('resFrom').textContent = from + 'p'; $('resTo').textContent = to + 'p'; }
  $('tabBtn').disabled = !reachable || !settings.enabled;
  $('tabBtn').classList.toggle('off', anyActive);
  $('tabBtnLabel').textContent = anyActive ? t('popDisableTab') : t('popEnableTab');
}

async function refreshStatus() {
  if (!tab) { reachable = false; return setStatus('idle', t('popNoAccess')); }
  try {
    const res = await api.tabs.sendMessage(tab.id, { type: 'status' });
    reachable = true;
    const vids = (res && res.videos) || [];
    const act = vids.filter((v) => v.active);
    anyActive = act.length > 0;
    if (!vids.length) return setStatus('idle', t('popNone'));
    if (anyActive) return setStatus('on', t('popActive', [String(act.length), String(vids.length)]), act[0].src, act[0].out);
    const err = vids.find((v) => v.err);
    if (err && vids.length === 1) return setStatus('err', err.err);
    setStatus('idle', t('popIdle', [String(vids.length)]));
  } catch {
    reachable = false; anyActive = false;
    const url = (tab && tab.url) || '';
    setStatus('idle', /^(https?|file):/.test(url) ? t('popReload') : t('popNoAccess'));
  }
}

// Frosted "see-through" look: a blurred, live snapshot of the visible tab sits behind the popup.
// It is refreshed a couple of times per second (the browser's capture rate limit) while the popup
// is open, so playing video and page scrolls show through. Images only live in this popup's memory.
const BACKDROP_MS = 600;
let baseId = null;      // layer currently fully visible
let lastUrl = '';
let fading = false;
function showShot(url, w) {
  if (url === lastUrl || fading) return;   // nothing changed, or previous fade still running
  lastUrl = url;
  const nextId = baseId === 'shotA' ? 'shotB' : 'shotA';
  const next = $(nextId), dpr = window.devicePixelRatio || 1;
  next.style.backgroundImage = `url(${url})`;
  // the popup opens under the toolbar at the top-right corner of the page
  next.style.backgroundSize = `${w / dpr}px auto`;
  next.style.backgroundPosition = 'right 40px top 0';
  next.className = 'shot incoming';
  void next.offsetWidth;                   // commit opacity:0 before fading in
  fading = true;
  next.classList.add('in');
  setTimeout(() => {
    next.className = 'shot base';          // promote: stays opaque, no transition
    if (baseId) $(baseId).className = 'shot';
    baseId = nextId;
    fading = false;
  }, 380);
}
async function captureBackdrop() {
  try {
    const url = await api.tabs.captureVisibleTab({ format: 'jpeg', quality: 45 });
    const img = new Image();
    img.onload = () => showShot(url, img.naturalWidth);
    img.src = url;
    return true;
  } catch { return false; } // chrome:// / about: pages etc. — keep the plain dark backdrop
}
let backdropTimer = 0;
async function liveBackdrop() {
  clearTimeout(backdropTimer);
  document.querySelector('.backdrop').classList.toggle('off', !settings.glassPopup);
  document.body.classList.toggle('solid', !settings.glassPopup);
  if (!settings.glassPopup) return;              // solid color: no captures at all
  if (!(await captureBackdrop())) return;
  const tick = async () => {
    if (!settings.glassPopup) return;
    if (document.visibilityState === 'visible') await captureBackdrop();
    backdropTimer = setTimeout(tick, BACKDROP_MS);
  };
  backdropTimer = setTimeout(tick, BACKDROP_MS);
}

async function init() {
  [tab] = await api.tabs.query({ active: true, currentWindow: true });
  try { host = tab && tab.url && /^https?:/.test(tab.url) ? new URL(tab.url).hostname : ''; } catch { host = ''; }
  settings = await api.storage.sync.get(DEFAULTS);
  liveBackdrop();
  paint();
  refreshStatus();
  setInterval(refreshStatus, 1000);
}

$('enabled').addEventListener('change', (e) => { save({ enabled: e.target.checked }); paint(); refreshStatus(); });
$('sharpness').addEventListener('input', (e) => { save({ sharpness: Number(e.target.value) }); paint(); });
$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  save({ sharpness: Number(b.dataset.v) }); paint();
});
$('maxOutput').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  save({ maxOutput: Number(b.dataset.v) }); paint();
});
$('denoise').addEventListener('change', (e) => save({ denoise: e.target.checked }));
$('autoOn').addEventListener('change', (e) => save({ autoOn: e.target.checked }));
$('showButton').addEventListener('change', (e) => save({ showButton: e.target.checked }));
$('glassPopup').addEventListener('change', (e) => { save({ glassPopup: e.target.checked }); liveBackdrop(); });
$('siteOn').addEventListener('change', (e) => {
  const set = new Set(settings.disabledSites);
  if (e.target.checked) set.delete(host); else set.add(host);
  save({ disabledSites: [...set] });
});
$('tabBtn').addEventListener('click', async () => {
  if (!tab) return;
  await api.tabs.sendMessage(tab.id, { type: 'setAll', on: !anyActive }).catch(() => {});
  setTimeout(refreshStatus, 250);
});

init();
