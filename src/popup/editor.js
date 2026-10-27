// Rich text editing for note bodies: toolbar, selection memory, paste
// cleanup, link insertion/opening and copy.

import { sanitizeHtml, htmlToText } from '../lib/sanitize.js';

const COLORS = [
  ['#1a73e8', 'Xanh dương'], ['#d93025', 'Đỏ'], ['#188038', 'Xanh lá'],
  ['#e8710a', 'Cam'], ['#8430ce', 'Tím'], ['#5f6368', 'Xám'],
];
const STATE_COMMANDS = ['bold', 'italic', 'underline'];

// Local dev servers are usually plain http; everything else defaults to https.
function withScheme(url) {
  if (/^(https?|mailto):/i.test(url)) return url;
  return /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url) ? `http://${url}` : `https://${url}`;
}

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function initEditor({ toolbarEl, onNoteInput }) {
  const q = sel => toolbarEl.querySelector(sel);
  const linkPop = q('#linkPop');
  const linkInput = q('#linkInput');
  let lastBody = null;
  let savedRange = null;

  for (const [color, name] of COLORS) {
    const b = document.createElement('button');
    b.className = 'tb';
    b.dataset.cmd = 'color';
    b.dataset.color = color;
    b.title = `Màu chữ: ${name}`;
    b.setAttribute('aria-label', `Màu chữ ${name}`);
    b.innerHTML = `<span class="swatch" style="background:${color}"></span>`;
    q('#swatches').append(b);
  }

  function setEnabled(on) {
    toolbarEl.querySelectorAll('.tb').forEach(b => { b.disabled = !on; });
    q('#tbHint').textContent = on ? '' : 'Chọn một note để định dạng';
  }

  function updatePressed() {
    for (const cmd of STATE_COMMANDS) {
      q(`.tb[data-cmd="${cmd}"]`).setAttribute('aria-pressed', String(document.queryCommandState(cmd)));
    }
  }

  // The toolbar stays usable after focus leaves the note: remember the last
  // note and its selection, and put them back before running a command.
  // selectionchange alone is not reliable for caret moves, so the note's own
  // key/mouse/input events save the selection too.
  function saveSelection() {
    const sel = getSelection();
    if (lastBody && sel.rangeCount && lastBody.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
      updatePressed();
    }
  }
  document.addEventListener('selectionchange', saveSelection);

  function restoreSelection() {
    if (!lastBody || !lastBody.isConnected) return false;
    if (document.activeElement === lastBody) {
      saveSelection();
      return true;
    }
    lastBody.focus();
    if (savedRange && lastBody.contains(savedRange.startContainer)) {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    return true;
  }

  function changed() {
    if (lastBody) onNoteInput(lastBody);
  }

  // mousedown keeps the selection inside the note; click also covers keyboard use.
  toolbarEl.addEventListener('mousedown', e => {
    if (e.target.closest('.tb')) e.preventDefault();
  });
  toolbarEl.addEventListener('click', e => {
    const b = e.target.closest('.tb');
    if (!b || b.disabled || !restoreSelection()) return;
    const cmd = b.dataset.cmd;
    if (cmd === 'link') return openLink();
    if (cmd === 'color') document.execCommand('foreColor', false, b.dataset.color);
    else if (cmd === 'removeFormat') {
      document.execCommand('removeFormat');
      document.execCommand('unlink');
    } else document.execCommand(cmd);
    updatePressed();
    changed();
  });

  function openLink() {
    if (document.activeElement === lastBody) saveSelection();
    const text = savedRange ? String(savedRange).trim() : '';
    linkInput.value = /^https?:\/\//i.test(text) ? text : '';
    linkPop.classList.add('show');
    linkInput.focus();
  }

  function closeLink() {
    linkPop.classList.remove('show');
    restoreSelection();
  }

  function insertLink() {
    let url = linkInput.value.trim();
    if (!url) return closeLink();
    url = withScheme(url);
    closeLink();
    if (savedRange && !savedRange.collapsed) {
      document.execCommand('createLink', false, url);
    } else {
      const safe = escapeHtml(url);
      document.execCommand('insertHTML', false, sanitizeHtml(`<a href="${safe}">${safe}</a>`) + '&nbsp;');
    }
    changed();
  }

  q('#linkOk').addEventListener('click', insertLink);
  q('#linkCancel').addEventListener('click', closeLink);
  linkInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); insertLink(); }
    if (e.key === 'Escape') { e.preventDefault(); closeLink(); }
  });

  function attach(body) {
    body.addEventListener('focus', () => {
      lastBody = body;
      setEnabled(true);
    });
    for (const type of ['keyup', 'mouseup', 'input']) body.addEventListener(type, saveSelection);
    body.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openLink();
      }
    });
    body.addEventListener('paste', e => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      const clean = html
        ? sanitizeHtml(html)
        : escapeHtml(e.clipboardData.getData('text/plain')).replace(/\r?\n/g, '<br>');
      document.execCommand('insertHTML', false, clean);
      onNoteInput(body);
    });
    // Links open in a new tab on a plain click (the main use is opening saved URLs).
    body.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (!a || !body.contains(a)) return;
      e.preventDefault();
      chrome.tabs.create({ url: a.href });
    });
    body.addEventListener('mouseover', e => {
      const a = e.target.closest('a[href]');
      if (a && !a.title) a.title = a.href;
    });
  }

  async function copy(body) {
    const html = sanitizeHtml(body.innerHTML);
    const text = htmlToText(html);
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
    } catch {
      await navigator.clipboard.writeText(text);
    }
  }

  function reset() {
    lastBody = null;
    savedRange = null;
    linkPop.classList.remove('show');
    setEnabled(false);
  }

  reset();
  return { attach, copy, reset };
}
