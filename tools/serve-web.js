'use strict';
// Serve the site locally, the way Vercel serves it.
//
// Vercel's `cleanUrls` means /download resolves to download.html and /download.html redirects
// to /download. A plain file server does neither, so a page that works with `npm run
// serve:web` and breaks on Vercel is a real risk; this behaves like the deploy instead.
//
// Usage:  npm run serve:web [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

// The site is `web/` inside the desktop project and the repository root in the website's own
// repository, so it is found rather than assumed: this same file serves either one, and
// `npm run serve:web` means the same thing in both.
const here = path.join(__dirname, '..');
const root = fs.existsSync(path.join(here, 'web', 'vercel.json')) ? path.join(here, 'web') : here;
const port = Number(process.argv[2]) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.dmg': 'application/octet-stream',
  '.exe': 'application/octet-stream',
  '.zip': 'application/zip',
  '.AppImage': 'application/octet-stream',
  '.deb': 'application/vnd.debian.binary-package',
};

const send = (res, code, body, type) => {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname); }
  catch { return send(res, 400, 'Bad request'); }

  // Resolve inside web/ and refuse anything that climbs out of it.
  const target = path.normalize(path.join(root, pathname));
  if (!target.startsWith(root)) return send(res, 403, 'Forbidden');

  let file = target;
  const stat = fs.existsSync(file) ? fs.statSync(file) : null;
  if (stat && stat.isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    const asHtml = target + '.html';
    if (fs.existsSync(asHtml)) file = asHtml;
    else {
      const notFound = path.join(root, '404.html');
      return send(res, 404, fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Not found', 'text/html; charset=utf-8');
    }
  }
  // /download.html and /app.html are served by clean URLs in production, so a link that uses
  // them is a link to something that will not be there. Redirecting here makes that visible
  // in the terminal rather than only on the deployed site.
  if (pathname.endsWith('.html') && pathname !== '/404.html') {
    res.writeHead(301, { Location: pathname.replace(/\.html$/, '') + (new URL(req.url, 'http://local').search || '') });
    return res.end();
  }

  const ext = path.extname(file);
  const type = TYPES[ext] || 'text/plain; charset=utf-8';
  if (ext === '.html' || ext === '.exe' || ext === '.dmg' || ext === '.zip') {
    // Downloads and pages are read whole: these files are small enough that streaming them
    // adds a failure mode without buying anything.
    return send(res, 200, fs.readFileSync(file), type);
  }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Halo site on http://127.0.0.1:${port}/  (serving ${path.relative(process.cwd(), root) || 'web'})`);
  console.log('Ctrl+C to stop.');
});
server.on('error', (err) => {
  console.error(`Could not listen on ${port}: ${err.message}`);
  console.error('Another server is probably there already — pass a different port.');
  process.exit(1);
});
