/**
 * Legacy: one-time HTML→MD conversion. Now we use update-log.md + update-log_old.md.
 * Run: node scripts/convert-update-log-to-md.js (only if re-running from HTML source)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'update-log.md'); // or path to HTML file if re-converting
const content = fs.readFileSync(src, 'utf8');
const lines = content.split(/\r?\n/);

function htmlToMd(block) {
  const text = block.join('\n');
  return text
    .replace(/<b style="color: #667eea;">([^<]+)<\/b> <span[^>]*>\(([^)]+)\)<\/span>/g, '## $1 ($2)')
    .replace(/<b>([^<]+)<\/b>/g, '**$1**')
    .replace(/^• /gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const recent = lines.slice(0, 33);
const old = lines.slice(33);

fs.writeFileSync(path.join(root, 'update-log.md'), htmlToMd(recent) + '\n', 'utf8');
fs.writeFileSync(path.join(root, 'update-log_old.md'), htmlToMd(old) + '\n', 'utf8');
console.log('Done: update-log.md (recent), update-log_old.md (archive)');
