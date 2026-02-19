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
const ADMIN_RESET_TOKEN = process.env.ADMIN_RESET_TOKEN || '';

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
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });

  if (USE_MONGO) {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    submissionsCollection = mongoClient.db(MONGODB_DB_NAME).collection(MONGODB_COLLECTION);
    await submissionsCollection.createIndex({ id: 1 }, { unique: true });
    await submissionsCollection.createIndex({ teamId: 1 });
    return;
  }

  await fsp.mkdir(DATA_DIR, { recursive: true });
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

async function parseJsonBody(req, maxBytes = 25 * 1024 * 1024) {
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

async function readBodyBuffer(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartBody(contentType, bodyBuffer) {
  const boundaryMatch = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
  if (!boundary) {
    throw new Error('Missing multipart boundary');
  }

  const boundaryToken = `--${boundary}`;
  const bodyText = bodyBuffer.toString('latin1');
  const fields = {};
  let file = null;
  let cursor = 0;

  while (true) {
    const start = bodyText.indexOf(boundaryToken, cursor);
    if (start === -1) break;
    let partStart = start + boundaryToken.length;

    if (bodyText.slice(partStart, partStart + 2) === '--') break;
    if (bodyText.slice(partStart, partStart + 2) === '\r\n') {
      partStart += 2;
    }

    const headerEnd = bodyText.indexOf('\r\n\r\n', partStart);
    if (headerEnd === -1) break;

    const headerText = bodyText.slice(partStart, headerEnd);
    const nextBoundary = bodyText.indexOf(`\r\n${boundaryToken}`, headerEnd + 4);
    if (nextBoundary === -1) break;

    const partDataStart = headerEnd + 4;
    const partDataEnd = nextBoundary;
    const partBuffer = bodyBuffer.subarray(partDataStart, partDataEnd);

    const dispositionLine = headerText
      .split('\r\n')
      .find((line) => line.toLowerCase().startsWith('content-disposition:'));

    if (dispositionLine) {
      const nameMatch = dispositionLine.match(/name="([^"]+)"/i);
      const filenameMatch = dispositionLine.match(/filename="([^"]*)"/i);
      const name = nameMatch ? nameMatch[1] : '';
      const fileName = filenameMatch ? filenameMatch[1] : '';
      const typeLine = headerText
        .split('\r\n')
        .find((line) => line.toLowerCase().startsWith('content-type:'));
      const mimeType = typeLine ? typeLine.split(':')[1].trim().toLowerCase() : '';
      const isLikelyFilePart = Boolean(typeLine) || name === 'photo' || !!fileName;

      if (isLikelyFilePart) {
        file = {
          fieldName: name || 'photo',
          filename: fileName || 'camera-photo',
          mimeType: mimeType || 'application/octet-stream',
          buffer: partBuffer
        };
      } else if (name) {
        fields[name] = partBuffer.toString('utf-8');
      }
    }

    cursor = nextBoundary + 2;
  }

  return { fields, file };
}

function extensionFromMimeOrName(mimeType, fileName) {
  const extByMime = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
    'image/heif': '.heif'
  };
  if (extByMime[mimeType]) return extByMime[mimeType];

  const rawExt = path.extname(fileName || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'].includes(rawExt)) {
    return rawExt === '.jpeg' ? '.jpg' : rawExt;
  }
  return '.jpg';
}

function parseBoolean(value, defaultValue = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return defaultValue;
}

async function handleSubmission(req, res) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  let payload;
  let photoBuffer;
  let photoMimeType;
  let originalPhotoName = 'camera-photo';

  try {
    if (contentType.includes('multipart/form-data')) {
      const bodyBuffer = await readBodyBuffer(req);
      const parsed = parseMultipartBody(contentType, bodyBuffer);
      payload = parsed.fields || {};
      if (!parsed.file || !parsed.file.buffer || !parsed.file.buffer.length) {
        return sendJson(res, 400, { error: 'Missing photo file' });
      }
      photoBuffer = parsed.file.buffer;
      photoMimeType = parsed.file.mimeType;
      originalPhotoName = parsed.file.filename || originalPhotoName;
    } else {
      payload = await parseJsonBody(req);
      const match = String(payload.photoDataUrl || '').match(DATA_URL_PATTERN);
      if (!match) {
        return sendJson(res, 400, { error: 'photoDataUrl must be a valid base64 image data URL' });
      }
      photoMimeType = match[1].toLowerCase();
      photoBuffer = Buffer.from(match[2], 'base64');
      originalPhotoName = String(payload.photoName || originalPhotoName);
    }
  } catch (error) {
    const code = error.message === 'Payload too large' ? 413 : 400;
    return sendJson(res, code, { error: error.message });
  }

  const requiredFields = ['teamId', 'teamName', 'questionId', 'question', 'answer'];
  for (const field of requiredFields) {
    if (!payload[field]) {
      return sendJson(res, 400, { error: `Missing field: ${field}` });
    }
  }

  const extension = extensionFromMimeOrName(photoMimeType, originalPhotoName);
  const now = new Date();
  const safeTeam = sanitizeFilePart(payload.teamId);
  const safeQuestion = sanitizeFilePart(payload.questionId);
  const fileName = `${now.getTime()}-team${safeTeam}-q${safeQuestion}${extension}`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  try {
    await fsp.writeFile(filePath, photoBuffer);

    const id = await nextSubmissionId();
    const record = {
      id,
      teamId: String(payload.teamId),
      teamName: String(payload.teamName),
      questionId: Number(payload.questionId),
      question: String(payload.question),
      answer: String(payload.answer),
      isCorrect: parseBoolean(payload.isCorrect, true),
      submittedAt: String(payload.timestamp || now.toLocaleTimeString()),
      createdAt: now.toISOString(),
      originalPhotoName: String(originalPhotoName || 'camera-photo'),
      photoMimeType: String(photoMimeType || ''),
      photoPath: `/uploads/${fileName}`
    };

    if (USE_MONGO) {
      await submissionsCollection.insertOne(record);
    } else {
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

async function removeAllUploadedFiles() {
  try {
    const entries = await fsp.readdir(UPLOADS_DIR, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map((entry) => fsp.unlink(path.join(UPLOADS_DIR, entry.name)))
    );
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
}

async function resetAllSubmissions() {
  if (USE_MONGO) {
    await submissionsCollection.deleteMany({});
  } else {
    await writeSubmissions([]);
  }

  await removeAllUploadedFiles();
}

async function handleResetSubmissions(req, res) {
  let body = {};
  try {
    body = await parseJsonBody(req, 2 * 1024 * 1024);
  } catch (error) {
    const code = error.message === 'Payload too large' ? 413 : 400;
    return sendJson(res, code, { error: error.message });
  }

  if (ADMIN_RESET_TOKEN && String(body.token || '') !== ADMIN_RESET_TOKEN) {
    return sendJson(res, 401, { error: 'Invalid admin reset token' });
  }

  try {
    await resetAllSubmissions();
    return sendJson(res, 200, { success: true, message: 'All submissions and uploaded photos cleared.' });
  } catch (error) {
    console.error('Failed to reset submissions:', error);
    return sendJson(res, 500, { error: 'Failed to reset submissions' });
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

    if (req.method === 'POST' && urlObj.pathname === '/api/admin/reset-submissions') {
      return handleResetSubmissions(req, res);
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
