import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const appRoot = join(frontRoot, 'src', 'app');

async function pageTemplates(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return pageTemplates(path);
      return entry.name.endsWith('.page.html') ? [path] : [];
    }),
  );
  return nested.flat();
}

function nestedContentOutsideOverlay(template) {
  const stack = [];
  const tags = template.matchAll(/<(\/)?(ion-content|ion-modal|ion-popover)\b[^>]*>/gi);

  for (const tag of tags) {
    const closing = Boolean(tag[1]);
    const name = tag[2].toLowerCase();
    if (closing) {
      const index = stack.lastIndexOf(name);
      if (index !== -1) stack.splice(index, 1);
      continue;
    }

    if (name === 'ion-content') {
      const previousContent = stack.lastIndexOf('ion-content');
      const overlayBoundary = Math.max(
        stack.lastIndexOf('ion-modal'),
        stack.lastIndexOf('ion-popover'),
      );
      if (previousContent > overlayBoundary) return true;
    }
    stack.push(name);
  }

  return false;
}

test('cada página Ionic tiene un único ion-content por vista', async () => {
  const templates = await pageTemplates(appRoot);
  assert.ok(templates.length > 0);

  for (const path of templates) {
    const template = await readFile(path, 'utf8');
    const label = relative(frontRoot, path);
    assert.match(template, /<ion-content\b/i, `${label} debe declarar ion-content`);
    assert.equal(
      nestedContentOutsideOverlay(template),
      false,
      `${label} anida ion-content dentro de la misma vista`,
    );
  }
});
