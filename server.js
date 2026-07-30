/**
 * Chronos - Backend Server (Express, Upstash Redis Cloud & Disk Persistence)
 * 100% Cloud-Ready: connessione sicura TLS a Redis Cloud 24/7.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'chronos_secret_key_2026_super_secure';
const DB_FILE_PATH = path.join(__dirname, 'chronos_db.json');

const app = express();
app.use(cors({ origin: '*' })); // Abilita CORS per l'accesso mobile/PWA
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==========================================
// 1. GESTIONE DATABASE REDIS CLOUD & FALLBACK PERSISTENTE
// ==========================================
let memoryDb = {
  users: {},
  events: {},
  tasks: {}
};

function loadDiskBackup() {
  try {
    if (fs.existsSync(DB_FILE_PATH)) {
      const raw = fs.readFileSync(DB_FILE_PATH, 'utf8');
      const data = JSON.parse(raw);
      memoryDb = { ...memoryDb, ...data };
      console.log('📁 Backup locale da disco (chronos_db.json) caricato.');
    }
  } catch (e) {
    console.error('Errore lettura backup:', e);
  }
}

function saveDiskBackup() {
  try {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(memoryDb, null, 2), 'utf8');
  } catch (e) {
    console.error('Errore salvataggio backup:', e);
  }
}

loadDiskBackup();

let redisClient = null;
let isRedisConnected = false;

async function initRedis() {
  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL;

  if (!redisUrl) {
    console.log('ℹ️ REDIS_URL non impostato. In esecuzione con memoria persistente.');
    return;
  }

  try {
    const { createClient } = require('redis');
    
    // Supporto TLS per Upstash Redis Cloud (rediss://)
    const clientOptions = {
      url: redisUrl
    };

    if (redisUrl.startsWith('rediss://')) {
      clientOptions.socket = {
        tls: true,
        rejectUnauthorized: false
      };
    }

    redisClient = createClient(clientOptions);

    redisClient.on('error', (err) => {
      if (isRedisConnected) {
        console.warn('⚠️ Avviso Redis Cloud:', err.message);
      }
      isRedisConnected = false;
    });

    redisClient.on('connect', () => {
      console.log('⚡ Connesso con successo al Database REDIS CLOUD 24/7!');
      isRedisConnected = true;
    });

    await redisClient.connect();
  } catch (e) {
    console.log('ℹ️ Impossibile connettersi a Redis Cloud. Utilizzo storage di fallback.');
  }
}

initRedis();

async function getDbItem(key) {
  if (isRedisConnected && redisClient) {
    try {
      return await redisClient.get(key);
    } catch (e) {}
  }
  return memoryDb[key] || null;
}

async function setDbItem(key, value) {
  memoryDb[key] = value;
  saveDiskBackup();

  if (isRedisConnected && redisClient) {
    try {
      await redisClient.set(key, value);
    } catch (e) {}
  }
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + JWT_SECRET).digest('hex');
}

function generateToken(username) {
  const payload = { username, exp: Date.now() + (60 * 24 * 60 * 60 * 1000) }; // Token valido 60 giorni
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifyToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (payload.exp && payload.exp > Date.now()) {
      return payload.username;
    }
  } catch (e) {}
  return null;
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token non fornito' });

  const username = verifyToken(token);
  if (!username) return res.status(403).json({ error: 'Token non valido o scaduto' });

  req.username = username;
  next();
}

// ==========================================
// 2. ENDPOINTS API AUTENTICAZIONE
// ==========================================

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password || username.trim().length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Username (min 3 caratteri) e Password (min 4 caratteri) obbligatori.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const userKey = `user:${cleanUsername}:auth`;

  const existingUser = await getDbItem(userKey);
  if (existingUser) {
    return res.status(400).json({ error: 'Username già in uso. Scegli un altro nome utente o effettua il Login.' });
  }

  const userObj = {
    username: cleanUsername,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };

  await setDbItem(userKey, JSON.stringify(userObj));
  const token = generateToken(cleanUsername);

  res.json({ success: true, username: cleanUsername, token });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Inserisci sia Username che Password.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const userKey = `user:${cleanUsername}:auth`;

  const userDataRaw = await getDbItem(userKey);
  if (!userDataRaw) {
    return res.status(401).json({ error: 'Credenziali non valide. Account non trovato.' });
  }

  const userData = JSON.parse(userDataRaw);
  if (userData.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Password errata.' });
  }

  const token = generateToken(cleanUsername);
  res.json({ success: true, username: cleanUsername, token });
});

// ==========================================
// 3. ENDPOINTS API SINCRONIZZAZIONE
// ==========================================

app.get('/api/sync', authenticateToken, async (req, res) => {
  const username = req.username;
  const eventsKey = `user:${username}:events`;
  const tasksKey = `user:${username}:tasks`;

  const eventsRaw = await getDbItem(eventsKey);
  const tasksRaw = await getDbItem(tasksKey);

  const events = eventsRaw ? JSON.parse(eventsRaw) : [];
  const tasks = tasksRaw ? JSON.parse(tasksRaw) : [];

  res.json({ success: true, events, tasks, cloudConnected: isRedisConnected });
});

app.post('/api/sync', authenticateToken, async (req, res) => {
  const username = req.username;
  const { events, tasks } = req.body;

  if (!Array.isArray(events) || !Array.isArray(tasks)) {
    return res.status(400).json({ error: 'Formato dati non valido' });
  }

  const eventsKey = `user:${username}:events`;
  const tasksKey = `user:${username}:tasks`;

  await setDbItem(eventsKey, JSON.stringify(events));
  await setDbItem(tasksKey, JSON.stringify(tasks));

  res.json({ success: true, timestamp: Date.now(), cloudConnected: isRedisConnected });
});

// Avvio Server Cloud
app.listen(PORT, () => {
  console.log(`🚀 Chronos Cloud Server attivo sulla porta ${PORT}`);
});
