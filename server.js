const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const STORAGE_ROOT = process.env.STORAGE_ROOT || ROOT;
const DATA_DIR = path.join(STORAGE_ROOT, 'data');
const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

const DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sanitizeFilePart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
}

async function ensureStorage() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });

  try {
    await fsp.access(SUBMISSIONS_FILE);
  } catch {
    await fsp.writeFile(SUBMISSIONS_FILE, '[]', 'utf-8');
  }
}

async function readSubmissions() {
  const raw = await fsp.readFile(SUBMISSIONS_FILE, 'utf-8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function writeSubmissions(items) {
  await fsp.writeFile(SUBMISSIONS_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

async function parseJsonBody(req, maxBytes = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('Payload too large'));
      }
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

async function handleSubmission(req, res) {
  let payload;
  try {
    payload = await parseJsonBody(req);
  } catch (error) {
    const code = error.message === 'Payload too large' ? 413 : 400;
    return sendJson(res, code, { error: error.message });
  }

  const requiredFields = ['teamId', 'teamName', 'questionId', 'question', 'answer', 'photoDataUrl'];
  for (const field of requiredFields) {
    if (!payload[field]) {
      return sendJson(res, 400, { error: `Missing field: ${field}` });
    }
  }

  const match = String(payload.photoDataUrl).match(DATA_URL_PATTERN);
  if (!match) {
    return sendJson(res, 400, { error: 'photoDataUrl must be a valid base64 image data URL' });
  }

  const mimeType = match[1].toLowerCase();
  const base64Data = match[2];
  const extByMime = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
  };

  const extension = extByMime[mimeType] || '.jpg';
  const now = new Date();
  const safeTeam = sanitizeFilePart(payload.teamId);
  const safeQuestion = sanitizeFilePart(payload.questionId);
  const fileName = `${now.getTime()}-team${safeTeam}-q${safeQuestion}${extension}`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  try {
    await fsp.writeFile(filePath, Buffer.from(base64Data, 'base64'));

    const submissions = await readSubmissions();
    const record = {
      id: submissions.length + 1,
      teamId: String(payload.teamId),
      teamName: String(payload.teamName),
      questionId: Number(payload.questionId),
      question: String(payload.question),
      answer: String(payload.answer),
      isCorrect: payload.isCorrect !== false,
      submittedAt: String(payload.timestamp || now.toLocaleTimeString()),
      createdAt: now.toISOString(),
      originalPhotoName: String(payload.photoName || 'camera-photo'),
      photoPath: `/uploads/${fileName}`
    };

    submissions.push(record);
    await writeSubmissions(submissions);

    return sendJson(res, 201, { success: true, record });
  } catch (error) {
    console.error('Failed to save submission:', error);
    return sendJson(res, 500, { error: 'Failed to save submission' });
  }
}

async function handleGetSubmissions(req, res, urlObj) {
  try {
    const submissions = await readSubmissions();
    const filterTeamId = urlObj.searchParams.get('teamId');

    const filtered = filterTeamId
      ? submissions.filter((item) => String(item.teamId) === String(filterTeamId))
      : submissions;

    return sendJson(res, 200, filtered);
  } catch (error) {
    console.error('Failed to read submissions:', error);
    return sendJson(res, 500, { error: 'Failed to read submissions' });
  }
}

function resolvePathname(urlObj) {
  if (urlObj.pathname === '/') return '/login.html';
  return urlObj.pathname;
}

function serveUploadedFile(res, requestPath) {
  const requested = decodeURIComponent(requestPath).replace(/^\/uploads\//, '');
  const normalized = path.normalize(requested);

  if (!normalized || normalized.startsWith('..') || path.isAbsolute(normalized)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const fullPath = path.join(UPLOADS_DIR, normalized);
  fs.stat(fullPath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mimeType });
    fs.createReadStream(fullPath).pipe(res);
  });
}

function serveStaticFile(res, requestPath) {
  const decodedPath = decodeURIComponent(requestPath);
  const fullPath = path.normalize(path.join(ROOT, decodedPath));

  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(fullPath, (statErr, stats) => {
    if (statErr || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mimeType });
    fs.createReadStream(fullPath).pipe(res);
  });
}

async function start() {
  await ensureStorage();

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || `localhost:${PORT}`;
    const urlObj = new URL(req.url || '/', `http://${host}`);

    if (req.method === 'POST' && urlObj.pathname === '/api/submissions') {
      return handleSubmission(req, res);
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/submissions') {
      return handleGetSubmissions(req, res, urlObj);
    }

    if (req.method === 'GET' && urlObj.pathname.startsWith('/uploads/')) {
      return serveUploadedFile(res, urlObj.pathname);
    }

    const pathname = resolvePathname(urlObj);
    return serveStaticFile(res, pathname);
  });

  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
