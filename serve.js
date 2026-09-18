import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, 'dist');
const port = process.env.PORT || 3000;

const mime = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript',
  '.css':   'text/css',
  '.json':  'application/json',
  '.png':   'image/png',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.webp':  'image/webp',
};

async function serveFile(res, filePath, cacheHeader) {
  const data = await readFile(filePath);
  res.writeHead(200, {
    'Content-Type': mime[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': cacheHeader,
  });
  res.end(data);
}

function serveIndex(res) {
  return serveFile(res, join(dist, 'index.html'), 'no-cache, no-store, must-revalidate');
}

createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  const filePath = join(dist, pathname);

  if (!filePath.startsWith(dist)) {
    res.writeHead(403);
    res.end();
    return;
  }

  const isAsset = pathname.startsWith('/assets/');

  try {
    await serveFile(
      res,
      filePath,
      isAsset ? 'public, max-age=31536000, immutable' : 'no-cache, no-store, must-revalidate',
    );
  } catch {
    await serveIndex(res);
  }
}).listen(port, () => console.log(`Listening on :${port}`));
