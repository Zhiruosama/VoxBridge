import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((name) => name.endsWith('.md') && existsSync(name));
const problems = [];
const anchorCache = new Map();
let links = 0;
function withoutFences(text) {
  let fence = '';
  return text
    .split('\n')
    .filter((line) => {
      const match = line.match(/^\s*(`{3,}|~{3,})/);
      if (match) {
        if (!fence) fence = match[1][0];
        else if (fence === match[1][0]) fence = '';
        return false;
      }
      return !fence;
    })
    .join('\n');
}
function anchors(path) {
  if (anchorCache.has(path)) return anchorCache.get(path);
  const text = withoutFences(readFileSync(path, 'utf8'));
  const result = new Set();
  const duplicates = new Map();
  for (const line of text.split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const slug = heading[1]
      .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '')
      .trim()
      .replace(/\s/g, '-');
    const count = duplicates.get(slug) ?? 0;
    result.add(count ? `${slug}-${count}` : slug);
    duplicates.set(slug, count + 1);
  }
  for (const match of text.matchAll(/<(?:a|span)[^>]*(?:id|name)=["']([^"']+)["']/g))
    result.add(match[1]);
  anchorCache.set(path, result);
  return result;
}
for (const file of files) {
  const text = withoutFences(readFileSync(file, 'utf8'));
  for (const match of text.matchAll(
    /!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\s*\)/g,
  )) {
    const raw = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('//')) continue;
    links++;
    let target, fragment;
    try {
      const split = raw.indexOf('#');
      const path = split < 0 ? raw : raw.slice(0, split);
      fragment = split < 0 ? '' : decodeURIComponent(raw.slice(split + 1));
      target = path ? resolve(dirname(file), decodeURIComponent(path)) : resolve(file);
    } catch {
      problems.push(`${file}: invalid URL ${raw}`);
      continue;
    }
    if (!existsSync(target)) {
      problems.push(`${file}: missing ${raw}`);
      continue;
    }
    if (
      fragment &&
      extname(target) === '.md' &&
      statSync(target).isFile() &&
      !/^L\d+(?:-L\d+)?$/.test(fragment) &&
      !anchors(target).has(fragment)
    )
      problems.push(`${file}: missing heading ${raw}`);
  }
  const userIntro =
    /^README(?:\.(?:en|ja|ru))?\.md$/.test(file) ||
    file.startsWith('docs/ru/') ||
    [
      'docs/README.md',
      'docs/user-guide.md',
      'docs/windows-installation.md',
      'docs/diagnostics.md',
    ].includes(file) ||
    file.startsWith('docs/guides/');
  if (userIntro && /\bv?\d+\.\d+\.\d+\b/.test(text))
    problems.push(`${file}: fixed application version in user-facing introduction`);
}
if (problems.length) {
  process.stderr.write(problems.join('\n') + '\n');
  process.exitCode = 1;
} else
  console.log(
    `Documentation checks passed: ${files.length} Markdown files, ${links} local links and anchors; user introductions are version-independent.`,
  );
