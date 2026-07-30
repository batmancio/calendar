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
// Disabilita la cache HTTP per Service Worker e Manifest per garantire l'aggiornamento immediato PWA su iOS
app.use((req, res, next) => {
  if (req.url === '/sw.js' || req.url === '/manifest.json' || req.path === '/sw.js' || req.path === '/manifest.json') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

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
    } catch (e) { }
  }
  return memoryDb[key] || null;
}

async function setDbItem(key, value) {
  memoryDb[key] = value;
  saveDiskBackup();

  if (isRedisConnected && redisClient) {
    try {
      await redisClient.set(key, value);
    } catch (e) { }
  }
}

async function deleteDbItem(key) {
  delete memoryDb[key];
  saveDiskBackup();

  if (isRedisConnected && redisClient) {
    try {
      await redisClient.del(key);
    } catch (e) { }
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
  } catch (e) { }
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

// Cambio Password Utente Autonomo
app.post('/api/user/change-password', authenticateToken, async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Fornisci la password attuale e la nuova password (min 4 caratteri).' });
  }

  const userKey = `user:${req.username}:auth`;
  const userDataRaw = await getDbItem(userKey);

  if (!userDataRaw) {
    return res.status(404).json({ error: 'Utente non trovato.' });
  }

  const userData = JSON.parse(userDataRaw);

  if (userData.passwordHash !== hashPassword(oldPassword)) {
    return res.status(400).json({ error: 'La password attuale inserita non è corretta.' });
  }

  userData.passwordHash = hashPassword(newPassword);
  await setDbItem(userKey, JSON.stringify(userData));

  res.json({ success: true, message: 'Password aggiornata con successo! Utilizza la nuova password per i prossimi accessi.' });
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
  const notifyEmail = process.env.NOTIFY_EMAIL || 'matteo.mancini0619@gmail.com';

  console.log(`\n🚨 =================================================`);
  console.log(`📩 NUOVA SEGNALAZIONE BUG / SUGGERIMENTO RICEVUTA!`);
  console.log(`👤 Da: ${feedback.displayName} (@${feedback.username}) - Ruolo: ${feedback.role}`);
  console.log(`📌 Tipo: [${feedback.type.toUpperCase()}]`);
  console.log(`🏷️ Oggetto: ${feedback.subject}`);
  console.log(`💬 Messaggio: ${feedback.message}`);
  console.log(`📅 Data: ${feedback.createdAt}`);
  console.log(`=================================================\n`);

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
        from: `"Planner Bug Alert" <${smtpUser}>`,
        to: notifyEmail,
        subject: `🚨 [Planner Alert] ${feedback.type.toUpperCase()}: ${feedback.subject}`,
        text: `Ciao Matteo,\n\nHai ricevuto un nuovo messaggio/bug report da parte di ${feedback.displayName} (@${feedback.username}).\n\nTipo: ${feedback.type}\nOggetto: ${feedback.subject}\n\nMessaggio:\n${feedback.message}\n\nData invio: ${feedback.createdAt}\n\nAccedi al Pannello Admin per gestire tutte le segnalazioni.`
      });
      console.log(`📧 Email di notifica diretta inviata a: ${notifyEmail}`);
    } catch (e) {
      console.warn('⚠️ Invio notifica email fallito (verifica credenziali SMTP):', e.message);
    }
  } else {
    console.log(`ℹ️ Segnalazione salvata nel Pannello Admin ed accessibile da @admin.`);
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

  if (cleanUsername === '__chronos_guest__') {
    return res.status(400).json({ error: 'Questo username è riservato alla modalità ospite e non può essere usato.' });
  }

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
  const tombstonesKey = `user:${username}:tombstones`;

  const eventsRaw = await getDbItem(eventsKey);
  const tasksRaw = await getDbItem(tasksKey);
  const tombstonesRaw = await getDbItem(tombstonesKey);

  const events = eventsRaw ? JSON.parse(eventsRaw) : [];
  const tasks = tasksRaw ? JSON.parse(tasksRaw) : [];
  const tombstones = tombstonesRaw ? JSON.parse(tombstonesRaw) : [];

  res.json({ success: true, events, tasks, tombstones, cloudConnected: isRedisConnected });
});

app.post('/api/sync', authenticateToken, async (req, res) => {
  const username = req.username;
  const { events, tasks, tombstones } = req.body;

  if (!Array.isArray(events) || !Array.isArray(tasks)) {
    return res.status(400).json({ error: 'Formato dati non valido' });
  }

  const eventsKey = `user:${username}:events`;
  const tasksKey = `user:${username}:tasks`;
  const tombstonesKey = `user:${username}:tombstones`;

  await setDbItem(eventsKey, JSON.stringify(events));
  await setDbItem(tasksKey, JSON.stringify(tasks));
  if (Array.isArray(tombstones)) {
    await setDbItem(tombstonesKey, JSON.stringify(tombstones));
  }

  res.json({ success: true, timestamp: Date.now(), cloudConnected: isRedisConnected });
});

// ==========================================
// 5. GESTIONE NOTIFICHE WEB PUSH & SCHEDULER IN BACKGROUND
// ==========================================
let webPush = null;
try {
  webPush = require('web-push');
} catch (e) {
  console.warn('⚠️ web-push non ancora disponibile nel nodo locale.');
}

let vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || null,
  privateKey: process.env.VAPID_PRIVATE_KEY || null,
  mailto: process.env.VAPID_MAILTO || 'mailto:matteo.mancini0619@gmail.com'
};

async function initVapidKeys() {
  const storedKeysRaw = await getDbItem('vapid_keys');
  if (storedKeysRaw) {
    vapidKeys = { ...vapidKeys, ...JSON.parse(storedKeysRaw) };
  } else if (webPush) {
    try {
      const generated = webPush.generateVAPIDKeys();
      vapidKeys.publicKey = generated.publicKey;
      vapidKeys.privateKey = generated.privateKey;
      await setDbItem('vapid_keys', JSON.stringify(vapidKeys));
    } catch (e) { }
  }

  if (webPush && vapidKeys.publicKey && vapidKeys.privateKey) {
    try {
      webPush.setVapidDetails(
        vapidKeys.mailto,
        vapidKeys.publicKey,
        vapidKeys.privateKey
      );
      console.log('🔔 Modulo Web Push VAPID pronto ed operativo!');
    } catch (err) {
      console.warn('⚠️ Errore configurazione VAPID:', err.message);
    }
  }
}
setTimeout(initVapidKeys, 600);

// Endpoint per recuperare la Chiave Pubblica VAPID
app.get('/api/push/vapid-public-key', (req, res) => {
  if (!vapidKeys.publicKey) {
    return res.status(503).json({ error: 'Notifiche Push non pronte. VAPID keys non ancora generate.' });
  }
  res.json({ success: true, publicKey: vapidKeys.publicKey });
});

// Endpoint per salvare la Subscription dell'utente
app.post('/api/push/subscribe', authenticateToken, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Subscription non valida.' });
  }

  const username = req.username;
  const subKey = `user:${username}:push_subscriptions`;
  const existingRaw = await getDbItem(subKey);
  let subscriptions = existingRaw ? JSON.parse(existingRaw) : [];

  if (!subscriptions.some(s => s.endpoint === subscription.endpoint)) {
    subscriptions.push(subscription);
    await setDbItem(subKey, JSON.stringify(subscriptions));
  }

  res.json({ success: true, message: 'Iscrizione alle notifiche Push salvata con successo.' });
});

// Endpoint per disiscriversi dalle notifiche Push
app.post('/api/push/unsubscribe', authenticateToken, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint richiesto.' });

  const username = req.username;
  const subKey = `user:${username}:push_subscriptions`;
  const existingRaw = await getDbItem(subKey);
  if (existingRaw) {
    let subscriptions = JSON.parse(existingRaw);
    subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
    await setDbItem(subKey, JSON.stringify(subscriptions));
  }

  res.json({ success: true, message: 'Disiscrizione notifiche Push completata.' });
});

// Endpoint Notifica di Prova
app.post('/api/push/test', authenticateToken, async (req, res) => {
  if (!webPush || !vapidKeys.publicKey) {
    return res.status(503).json({ error: 'Modulo Web Push non ancora configurato sul server.' });
  }

  const username = req.username;
  const subKey = `user:${username}:push_subscriptions`;
  const existingRaw = await getDbItem(subKey);
  const subscriptions = existingRaw ? JSON.parse(existingRaw) : [];

  if (subscriptions.length === 0) {
    return res.status(404).json({ error: 'Nessun dispositivo registrato per le notifiche Push su questo account. Abilita prima le notifiche dal menu.' });
  }

  const payload = JSON.stringify({
    title: '🔔 Notifica di Prova Chronos',
    body: 'Le Notifiche Push ad app chiusa funzionano perfettamente su questo dispositivo! 🎉',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    url: '/'
  });

  let sentCount = 0;
  const validSubscriptions = [];

  for (const sub of subscriptions) {
    try {
      await webPush.sendNotification(sub, payload);
      sentCount++;
      validSubscriptions.push(sub);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        console.log(`🗑️ Rimozione subscription scaduta/revocata per @${username}`);
      } else {
        validSubscriptions.push(sub);
        console.warn(`⚠️ Errore invio push notification:`, err.message);
      }
    }
  }

  await setDbItem(subKey, JSON.stringify(validSubscriptions));

  if (sentCount > 0) {
    res.json({ success: true, message: `Notifica di prova inviata a ${sentCount} dispositivo/i.` });
  } else {
    res.status(500).json({ error: 'Impossibile inviare la notifica di prova. Verifica i permessi notifiche nel browser o sul dispositivo.' });
  }
});

// Helper Invio Push Generico ad un Utente
async function sendPushToUser(username, title, body, tag = null) {
  if (!webPush || !vapidKeys.publicKey) return;

  const subKey = `user:${username}:push_subscriptions`;
  const existingRaw = await getDbItem(subKey);
  if (!existingRaw) return;

  const subscriptions = JSON.parse(existingRaw);
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title,
    body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: tag || `push_${Date.now()}`,
    url: '/'
  });

  const validSubscriptions = [];
  for (const sub of subscriptions) {
    try {
      await webPush.sendNotification(sub, payload);
      validSubscriptions.push(sub);
    } catch (err) {
      if (err.statusCode !== 410 && err.statusCode !== 404) {
        validSubscriptions.push(sub);
      }
    }
  }

  await setDbItem(subKey, JSON.stringify(validSubscriptions));
}

// Scheduler in Background (Controlla ogni minuto gli eventi imminenti)
function startPushScheduler() {
  setInterval(async () => {
    if (!webPush || !vapidKeys.publicKey) return;

    try {
      const users = await getUsersIndex();
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const todayStr = `${year}-${month}-${day}`;

      for (const username of users) {
        const pushedKey = `user:${username}:pushed_tags_${todayStr}`;
        const pushedRaw = await getDbItem(pushedKey);
        const pushedTags = pushedRaw ? new Set(JSON.parse(pushedRaw)) : new Set();

        const eventsRaw = await getDbItem(`user:${username}:events`);
        const tasksRaw = await getDbItem(`user:${username}:tasks`);

        const events = eventsRaw ? JSON.parse(eventsRaw) : [];
        const tasks = tasksRaw ? JSON.parse(tasksRaw) : [];

        // Eventi di Oggi con orario di inizio imminente (entro 15 min)
        events.forEach(event => {
          if (!event.date || event.date !== todayStr) return;
          const tag = `event_${event.id}_${todayStr}`;
          if (pushedTags.has(tag)) return;

          let shouldNotify = false;
          if (event.timeStart) {
            const [eH, eM] = event.timeStart.split(':').map(Number);
            const eventMinutes = eH * 60 + eM;
            const nowMinutes = now.getHours() * 60 + now.getMinutes();

            if (eventMinutes >= nowMinutes && (eventMinutes - nowMinutes) <= 15) {
              shouldNotify = true;
            }
          } else {
            if (now.getHours() >= 8) {
              shouldNotify = true;
            }
          }

          if (shouldNotify) {
            const timeDesc = event.timeStart ? ` alle ${event.timeStart}` : '';
            sendPushToUser(username, `📅 Evento di oggi: ${event.title}`, `${event.title}${timeDesc}${event.description ? ' - ' + event.description : ''}`, tag);
            pushedTags.add(tag);
          }
        });

        // Memo Critici in Scadenza
        tasks.forEach(task => {
          if (task.status === 'completed') return;
          if (task.urgency !== 'critical') return;
          if (!task.dueDate || task.dueDate > todayStr) return;

          const tag = `task_${task.id}_${todayStr}`;
          if (pushedTags.has(tag)) return;

          if (now.getHours() >= 8) {
            const label = task.dueDate < todayStr ? `${task.title} (Scaduto)` : `${task.title} (Scade oggi)`;
            sendPushToUser(username, `🚨 Memo Critico in Scadenza`, label, tag);
            pushedTags.add(tag);
          }
        });

        await setDbItem(pushedKey, JSON.stringify(Array.from(pushedTags)));
      }
    } catch (e) {
      console.error('Errore nello Push Scheduler:', e.message);
    }
  }, 60000);
}

setTimeout(startPushScheduler, 5000);

// Avvio Server Cloud
app.listen(PORT, () => {
  console.log(`🚀 Chronos Cloud Server attivo sulla porta ${PORT}`);
});


