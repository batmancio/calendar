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

async function deleteDbItem(key) {
  delete memoryDb[key];
  saveDiskBackup();

  if (isRedisConnected && redisClient) {
    try {
      await redisClient.del(key);
    } catch (e) {}
  }
}

// Helpers Gestione Indice Utenti
async function getUsersIndex() {
  const indexRaw = await getDbItem('users_index');
  return indexRaw ? JSON.parse(indexRaw) : [];
}

async function addUserToIndex(username) {
  const index = await getUsersIndex();
  if (!index.includes(username)) {
    index.push(username);
    await setDbItem('users_index', JSON.stringify(index));
  }
}

async function removeUserFromIndex(username) {
  let index = await getUsersIndex();
  index = index.filter(u => u !== username);
  await setDbItem('users_index', JSON.stringify(index));
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

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token non fornito' });

  const username = verifyToken(token);
  if (!username) return res.status(403).json({ error: 'Token non valido o scaduto' });

  const userDataRaw = await getDbItem(`user:${username}:auth`);
  if (!userDataRaw) return res.status(403).json({ error: 'Utente non trovato' });

  const userData = JSON.parse(userDataRaw);
  req.username = username;
  req.user = {
    username: userData.username,
    displayName: userData.displayName || userData.username,
    role: userData.role || 'client'
  };
  next();
}

function authenticateAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accesso riservato unicamente all\'Amministratore.' });
  }
  next();
}

// Inizializzazione Utente Admin Predefinito
async function ensureAdminUser() {
  const adminKey = 'user:admin:auth';
  const adminRaw = await getDbItem(adminKey);

  if (!adminRaw) {
    const adminObj = {
      username: 'admin',
      displayName: 'Amministratore (Matteo)',
      role: 'admin',
      passwordHash: hashPassword('admin123'),
      createdAt: new Date().toISOString()
    };
    await setDbItem(adminKey, JSON.stringify(adminObj));
    await addUserToIndex('admin');
    console.log('👑 Account Admin predefinito inizializzato (Username: admin | Password: admin123)');
  } else {
    // Assicura che l'indice contenga l'admin
    await addUserToIndex('admin');
  }
}

// Chiama l'inizializzazione dell'admin
setTimeout(ensureAdminUser, 500);

// ==========================================
// 2. ENDPOINTS API AUTENTICAZIONE & PROFILO
// ==========================================

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  const userDataRaw = await getDbItem(`user:${req.username}:auth`);
  const userData = userDataRaw ? JSON.parse(userDataRaw) : {};
  res.json({
    success: true,
    user: {
      ...req.user,
      avatarDataUrl: userData.avatarDataUrl || null
    }
  });
});

// Salvataggio Immagine Profilo Utente
app.post('/api/user/profile-image', authenticateToken, async (req, res) => {
  const { avatarDataUrl } = req.body;
  const userKey = `user:${req.username}:auth`;
  const userDataRaw = await getDbItem(userKey);

  if (!userDataRaw) return res.status(404).json({ error: 'Utente non trovato' });

  const userData = JSON.parse(userDataRaw);
  userData.avatarDataUrl = avatarDataUrl || null;
  await setDbItem(userKey, JSON.stringify(userData));

  res.json({ success: true, avatarDataUrl: userData.avatarDataUrl });
});

// Invio Segnalazione Bug / Suggerimento
app.post('/api/feedback', authenticateToken, async (req, res) => {
  const { subject, message, type } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ error: 'Titolo e messaggio sono obbligatori.' });
  }

  const feedbacksRaw = await getDbItem('feedbacks_list');
  const feedbacks = feedbacksRaw ? JSON.parse(feedbacksRaw) : [];

  const newFeedback = {
    id: 'fb_' + Date.now(),
    username: req.username,
    displayName: req.user.displayName,
    role: req.user.role,
    subject: subject.trim(),
    message: message.trim(),
    type: type || 'bug',
    createdAt: new Date().toISOString(),
    read: false
  };

  feedbacks.unshift(newFeedback);
  await setDbItem('feedbacks_list', JSON.stringify(feedbacks));

  // Invia notifica email (Gmail / SMTP se configurato)
  sendFeedbackEmailNotification(newFeedback);

  res.json({ success: true, message: 'Segnalazione inviata con successo all\'amministratore.' });
});

async function sendFeedbackEmailNotification(feedback) {
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_PASS;
  const notifyEmail = process.env.NOTIFY_EMAIL || 'matteo.mancini.dev@gmail.com';

  console.log(`📩 [BUG/FEEDBACK] Ricevuta segnalazione da '${feedback.username}': "${feedback.subject}"`);

  if (smtpUser && smtpPass) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: 465,
        secure: true,
        auth: { user: smtpUser, pass: smtpPass }
      });

      await transporter.sendMail({
        from: `"Planner Notifiche" <${smtpUser}>`,
        to: notifyEmail,
        subject: `[Planner Bug/Feedback] ${feedback.type.toUpperCase()}: ${feedback.subject}`,
        text: `Nuova segnalazione inviata da: ${feedback.displayName} (${feedback.username})\nTipo: ${feedback.type}\n\nMessaggio:\n${feedback.message}\n\nInviato il: ${feedback.createdAt}`
      });
      console.log(`📧 Notifica inviata via Gmail a ${notifyEmail}`);
    } catch (e) {
      console.warn('⚠️ Notifica SMTP/Gmail non inviata:', e.message);
    }
  } else {
    console.log('ℹ️ Notifica salvata nel Pannello Admin.');
  }
}

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
  const userRole = userData.role || (cleanUsername === 'admin' ? 'admin' : 'client');
  const displayName = userData.displayName || cleanUsername;

  res.json({
    success: true,
    username: cleanUsername,
    displayName,
    role: userRole,
    token
  });
});

// ==========================================
// 3. ENDPOINTS API AMMINISTRAZIONE (PANNELLO ADMIN)
// ==========================================

// Elenco di tutti i clienti / utenti (Solo Admin)
app.get('/api/admin/users', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const userList = await getUsersIndex();
    const result = [];

    for (const uname of userList) {
      const userRaw = await getDbItem(`user:${uname}:auth`);
      if (userRaw) {
        const u = JSON.parse(userRaw);
        
        // Statistiche rapide memo/eventi
        const eventsRaw = await getDbItem(`user:${uname}:events`);
        const tasksRaw = await getDbItem(`user:${uname}:tasks`);
        const eventsCount = eventsRaw ? JSON.parse(eventsRaw).length : 0;
        const tasksCount = tasksRaw ? JSON.parse(tasksRaw).length : 0;

        result.push({
          username: u.username,
          displayName: u.displayName || u.username,
          role: u.role || 'client',
          createdAt: u.createdAt || 'N/D',
          eventsCount,
          tasksCount
        });
      }
    }

    res.json({ success: true, users: result });
  } catch (e) {
    res.status(500).json({ error: 'Errore durante il recupero degli utenti: ' + e.message });
  }
});

// Creazione di un nuovo account cliente (Solo Admin)
app.post('/api/admin/users', authenticateToken, authenticateAdmin, async (req, res) => {
  const { username, password, displayName, role } = req.body;

  if (!username || !password || username.trim().length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Username (min 3 car.) e Password (min 4 car.) obbligatori.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const userKey = `user:${cleanUsername}:auth`;

  const existingUser = await getDbItem(userKey);
  if (existingUser) {
    return res.status(400).json({ error: `L'utente '${cleanUsername}' esiste già.` });
  }

  const newUser = {
    username: cleanUsername,
    displayName: (displayName && displayName.trim()) ? displayName.trim() : cleanUsername,
    role: role === 'admin' ? 'admin' : 'client',
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };

  await setDbItem(userKey, JSON.stringify(newUser));
  await addUserToIndex(cleanUsername);

  res.json({ success: true, user: { username: newUser.username, displayName: newUser.displayName, role: newUser.role } });
});

// Reset Password Cliente (Solo Admin)
app.put('/api/admin/users/:username/password', authenticateToken, authenticateAdmin, async (req, res) => {
  const targetUsername = req.params.username.toLowerCase();
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'La nuova password deve contenere almeno 4 caratteri.' });
  }

  const userKey = `user:${targetUsername}:auth`;
  const userRaw = await getDbItem(userKey);

  if (!userRaw) {
    return res.status(404).json({ error: 'Utente non trovato.' });
  }

  const userObj = JSON.parse(userRaw);
  userObj.passwordHash = hashPassword(newPassword);

  await setDbItem(userKey, JSON.stringify(userObj));
  res.json({ success: true, message: `Password per '${targetUsername}' aggiornata con successo.` });
});

// Eliminazione Account Cliente e relativi dati (Solo Admin)
app.delete('/api/admin/users/:username', authenticateToken, authenticateAdmin, async (req, res) => {
  const targetUsername = req.params.username.toLowerCase();

  if (targetUsername === req.username) {
    return res.status(400).json({ error: 'Non puoi eliminare il tuo stesso account Admin in uso.' });
  }

  const userKey = `user:${targetUsername}:auth`;
  const eventsKey = `user:${targetUsername}:events`;
  const tasksKey = `user:${targetUsername}:tasks`;

  await deleteDbItem(userKey);
  await deleteDbItem(eventsKey);
  await deleteDbItem(tasksKey);
  await removeUserFromIndex(targetUsername);

  res.json({ success: true, message: `Account '${targetUsername}' ed i suoi dati eliminati.` });
});

// Recupero elenco segnalazioni bug / feedback (Solo Admin)
app.get('/api/admin/feedbacks', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const feedbacksRaw = await getDbItem('feedbacks_list');
    const feedbacks = feedbacksRaw ? JSON.parse(feedbacksRaw) : [];
    res.json({ success: true, feedbacks });
  } catch (e) {
    res.status(500).json({ error: 'Errore lettura segnalazioni: ' + e.message });
  }
});

// Eliminazione segnalazione (Solo Admin)
app.delete('/api/admin/feedbacks/:id', authenticateToken, authenticateAdmin, async (req, res) => {
  try {
    const feedbackId = req.params.id;
    const feedbacksRaw = await getDbItem('feedbacks_list');
    let feedbacks = feedbacksRaw ? JSON.parse(feedbacksRaw) : [];

    feedbacks = feedbacks.filter(f => f.id !== feedbackId);
    await setDbItem('feedbacks_list', JSON.stringify(feedbacks));

    res.json({ success: true, message: 'Segnalazione eliminata.' });
  } catch (e) {
    res.status(500).json({ error: 'Errore eliminazione segnalazione: ' + e.message });
  }
});

// ==========================================
// 4. ENDPOINTS API SINCRONIZZAZIONE
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

