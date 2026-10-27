import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, htmlToText } from '../src/lib/sanitize.js';

const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer"';

test('keeps allowed formatting', () => {
  assert.equal(sanitizeHtml('<b>x</b><i>y</i><u>z</u><br>'), '<b>x</b><i>y</i><u>z</u><br>');
  assert.equal(sanitizeHtml('<div>a</div><ul><li>b</li></ul>'), '<div>a</div><ul><li>b</li></ul>');
});

test('strips script and event handlers', () => {
  assert.equal(sanitizeHtml('<img src=x onerror=alert(1)><script>alert(1)</script>ok'), 'ok');
  assert.equal(sanitizeHtml('<b onclick="x()">t</b>'), '<b>t</b>');
});

test('drops javascript links but keeps text', () => {
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">t</a>'), `<a ${LINK_ATTRS}>t</a>`);
  assert.equal(sanitizeHtml('<a href=" JaVaScRiPt:alert(1)">t</a>'), `<a ${LINK_ATTRS}>t</a>`);
});

test('keeps http link with safe attrs', () => {
  assert.equal(
    sanitizeHtml('<a href="http://localhost:3000/x?a=1&amp;b=2" onclick="x">L</a>'),
    `<a href="http://localhost:3000/x?a=1&amp;b=2" ${LINK_ATTRS}>L</a>`,
  );
  assert.equal(sanitizeHtml("<a href='https://e.com/\"x'>L</a>"), `<a href="https://e.com/&quot;x" ${LINK_ATTRS}>L</a>`);
});

test('keeps only color style', () => {
  assert.equal(sanitizeHtml('<span style="color: #1a73e8; font-size: 40px">A</span>'), '<span style="color: #1a73e8">A</span>');
  assert.equal(sanitizeHtml('<span style="color: expression(x)">A</span>'), '<span>A</span>');
  assert.equal(sanitizeHtml('<span style="color: rgb(26, 115, 232)">A</span>'), '<span style="color: rgb(26, 115, 232)">A</span>');
  assert.equal(sanitizeHtml('<font color="#d93025" face="x">A</font>'), '<font color="#d93025">A</font>');
});

test('unwraps unknown tags', () => {
  assert.equal(sanitizeHtml('<table><tr><td>a</td></tr></table>'), 'a');
});

test('drops style blocks and comments', () => {
  assert.equal(sanitizeHtml('<style>b{}</style>x<!-- c -->'), 'x');
  assert.equal(sanitizeHtml('<head><title>T</title></head>y'), 'y');
});

test('closes unclosed tags and ignores stray closers', () => {
  assert.equal(sanitizeHtml('<b>x'), '<b>x</b>');
  assert.equal(sanitizeHtml('x</b></i>'), 'x');
  assert.equal(sanitizeHtml('<b><i>x</b>y'), '<b><i>x</i></b>y');
});

test('escapes stray angle brackets in text', () => {
  assert.equal(sanitizeHtml('1 < 2 > 0'), '1 &lt; 2 &gt; 0');
});

test('htmlToText', () => {
  assert.equal(htmlToText('<b>A</b><br>B&amp;C<div>D</div>'), 'A\nB&C\nD');
  assert.equal(htmlToText('x&nbsp;&lt;y&gt; &quot;q&quot; &#39;s&#39;'), 'x <y> "q" \'s\'');
});
