import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const scripts = readdirSync(new URL('../js/', import.meta.url)).map((f) => read(`js/${f}`)).concat(read('sw.js'));

test('page has a strict Content Security Policy', () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(csp, 'CSP meta tag missing');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/); // no 'unsafe-inline' / 'unsafe-eval'
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.doesNotMatch(csp, /unsafe-|\*|https?:/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

test('no inline scripts, event handlers or style attributes in the page', () => {
  assert.doesNotMatch(html, /<script>|<script\s+(?![^>]*\bsrc=)[^>]*>/, 'inline <script>');
  assert.doesNotMatch(html, /\son[a-z]+="/i, 'inline event handler');
  assert.doesNotMatch(html, /\sstyle="/i, 'inline style attribute');
});

test('scripts avoid HTML injection and code evaluation', () => {
  for (const src of scripts) {
    assert.doesNotMatch(src, /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/);
  }
});

test('page loads nothing from other sites', () => {
  assert.doesNotMatch(html, /(src|href)="https?:\/\//);
  for (const src of scripts) assert.doesNotMatch(src, /fetch\(\s*['"`]https?:|import[^;]*from\s*['"]https?:/);
});
