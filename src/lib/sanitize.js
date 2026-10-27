// Allowlist HTML sanitizer. String-based (no DOM) so it runs in the popup,
// the service worker and node tests alike. Output is rebuilt only from
// allowed tokens; everything else is unwrapped or dropped.

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'a', 'br', 'div', 'p', 'ul', 'ol', 'li', 'span', 'font']);
const VOID = new Set(['br']);
const DROP_CONTENT = new Set(['script', 'style', 'head', 'title', 'iframe', 'object', 'embed', 'template', 'noscript']);
const SAFE_SCHEME = /^(https?|mailto):/i;
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|[a-z]{3,20})$/i;
const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer"';

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;
const ATTR = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeAttr(s) {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(ATTR)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function safeColor(value) {
  const v = decodeEntities(value).trim();
  return SAFE_COLOR.test(v) ? v : null;
}

function openTag(name, attrSrc) {
  const attrs = parseAttrs(attrSrc);
  if (name === 'a') {
    // Strip whitespace/control chars before checking the scheme ("java\tscript:").
    const href = attrs.href !== undefined ? decodeEntities(attrs.href).replace(/[\s\u0000-\u001f]/g, '') : '';
    return SAFE_SCHEME.test(href)
      ? `<a href="${escapeAttr(attrs.href.trim())}" ${LINK_ATTRS}>`
      : `<a ${LINK_ATTRS}>`;
  }
  if (name === 'span' && attrs.style) {
    const decl = attrs.style.split(';').map(d => d.split(':')).find(([k]) => k.trim().toLowerCase() === 'color');
    const color = decl && decl.length === 2 ? safeColor(decl[1]) : null;
    return color ? `<span style="color: ${escapeAttr(color)}">` : '<span>';
  }
  if (name === 'font' && attrs.color) {
    const color = safeColor(attrs.color);
    return color ? `<font color="${escapeAttr(color)}">` : '<font>';
  }
  return `<${name}>`;
}

export function sanitizeHtml(html) {
  let out = '';
  const stack = [];
  let dropping = null;

  for (const m of String(html ?? '').matchAll(TOKEN)) {
    const token = m[0];
    const name = m[1]?.toLowerCase();
    const closing = token.startsWith('</');

    if (dropping) {
      if (name === dropping && closing) dropping = null;
      continue;
    }
    if (token.startsWith('<!--')) continue;
    if (!name) {
      out += token.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      continue;
    }
    if (DROP_CONTENT.has(name)) {
      if (!closing && !/\/\s*$/.test(m[2])) dropping = name;
      continue;
    }
    if (!ALLOWED.has(name)) continue;

    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at) out += `</${stack.pop()}>`;
    } else if (VOID.has(name)) {
      out += `<${name}>`;
    } else {
      out += openTag(name, m[2]);
      stack.push(name);
    }
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

export function htmlToText(html) {
  const text = String(html ?? '')
    // Chrome puts a placeholder <br> inside empty lines: <div><br></div>
    .replace(/<br\s*\/?>\s*(?=<\/(div|p|li)>)/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(div|p|li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text).replace(/^\n+|\s+$/g, '');
}
