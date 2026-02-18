const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const STORAGE_ROOT = process.env.STORAGE_ROOT || ROOT;
const DATA_DIR = path.join(STORAGE_ROOT, 'data');
const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const CREDENTIALS_FILE = path.join(ROOT, 'credentials.json');
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'campus_hunt';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'submissions';

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
const USE_MONGO = Boolean(MONGODB_URI);

let mongoClient;
let submissionsCollection;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function buildDefaultCredentials() {
  const teams = [];
  for (let i = 1; i <= 50; i += 1) {
    teams.push({
      id: String(i),
      password: `team@${i}`,
      name: `Team ${i}`
    });
  }
  return { teams };
}

async function readCredentials() {
  try {
    const raw = await fsp.readFile(CREDENTIALS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.teams)) {
      return parsed;
    }
  } catch {
    // Fall back to generated defaults when credentials file is unavailable.
  }

  return buildDefaultCredentials();
}

function sanitizeFilePart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
}

async function ensureStorage() {
  if (USE_MONGO) {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    submissionsCollection = mongoClient.db(MONGODB_DB_NAME).collection(MONGODB_COLLECTION);
    await submissionsCollection.createIndex({ id: 1 }, { unique: true });
    await submissionsCollection.createIndex({ teamId: 1 });
    return;
  }

  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });

  try {
    await fsp.access(SUBMISSIONS_FILE);
  } catch {
    await fsp.writeFile(SUBMISSIONS_FILE, '[]', 'utf-8');
  }
}

async function readSubmissions() {
  if (USE_MONGO) {
    return submissionsCollection.find({}).sort({ id: 1 }).toArray();
  }

  const raw = await fsp.readFile(SUBMISSIONS_FILE, 'utf-8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

async function writeSubmissions(items) {
  if (USE_MONGO) {
    return;
  }
  await fsp.writeFile(SUBMISSIONS_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

async function nextSubmissionId() {
  if (USE_MONGO) {
    const latest = await submissionsCollection.findOne({}, { sort: { id: -1 }, projection: { id: 1 } });
    return (latest?.id || 0) + 1;
  }

  const items = await readSubmissions();
  return items.length + 1;
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
    const id = await nextSubmissionId();
    const record = {
      id,
      teamId: String(payload.teamId),
      teamName: String(payload.teamName),
      questionId: Number(payload.questionId),
      question: String(payload.question),
      answer: String(payload.answer),
      isCorrect: payload.isCorrect !== false,
      submittedAt: String(payload.timestamp || now.toLocaleTimeString()),
      createdAt: now.toISOString(),
      originalPhotoName: String(payload.photoName || 'camera-photo')
    };

    if (USE_MONGO) {
      record.photoPath = String(payload.photoDataUrl);
      await submissionsCollection.insertOne(record);
    } else {
      await fsp.writeFile(filePath, Buffer.from(base64Data, 'base64'));
      record.photoPath = `/uploads/${fileName}`;
      const submissions = await readSubmissions();
      submissions.push(record);
      await writeSubmissions(submissions);
    }

    return sendJson(res, 201, { success: true, record });
  } catch (error) {
    console.error('Failed to save submission:', error);
    return sendJson(res, 500, { error: 'Failed to save submission' });
  }
}

async function handleGetSubmissions(req, res, urlObj) {
  try {
    const filterTeamId = urlObj.searchParams.get('teamId');
    let filtered;

    if (USE_MONGO) {
      const query = filterTeamId ? { teamId: String(filterTeamId) } : {};
      filtered = await submissionsCollection.find(query).sort({ id: 1 }).toArray();
    } else {
      const submissions = await readSubmissions();
      filtered = filterTeamId
        ? submissions.filter((item) => String(item.teamId) === String(filterTeamId))
        : submissions;
    }

    return sendJson(res, 200, filtered);
  } catch (error) {
    console.error('Failed to read submissions:', error);
    return sendJson(res, 500, { error: 'Failed to read submissions' });
  }
}

async function handleGetCredentials(_req, res) {
  try {
    const credentials = await readCredentials();
    return sendJson(res, 200, credentials);
  } catch (error) {
    console.error('Failed to read credentials:', error);
    return sendJson(res, 500, { error: 'Failed to read credentials' });
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

    if (req.method === 'GET' && (urlObj.pathname === '/api/credentials' || urlObj.pathname === '/credentials.json')) {
      return handleGetCredentials(req, res);
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
