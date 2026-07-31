/**
 * Chronos - Core Application (Clean, Minimalist & Resilient)
 */

(function () {
  'use strict';

  const API_BASE_URL = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

  const STORAGE_KEY_EVENTS = 'chronos_app_events_v1';
  const STORAGE_KEY_TASKS = 'chronos_app_tasks_v1';
  const STORAGE_KEY_TOKEN = 'chronos_jwt_token_v1';
  const STORAGE_KEY_USER = 'chronos_username_v1';
  const STORAGE_KEY_ROLE = 'chronos_user_role_v1';
  const STORAGE_KEY_DISPLAY_NAME = 'chronos_user_display_name_v1';
  const STORAGE_KEY_AVATAR = 'planner_user_avatar_v1';
  const GUEST_USERNAME = '__chronos_guest__';
  const STORAGE_KEY_GUEST_MODE = 'chronos_guest_mode_v1';
  const NOTIFIED_STORAGE_KEY = 'chronos_notified_ids_v1';

  if ('serviceWorker' in navigator) {
    let refreshing = false;

    // Ricarica automaticamente la pagina se un nuovo Service Worker prende il controllo (es. nuovi commit)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        // Controllo proattivo degli aggiornamenti all'avvio
        reg.update().catch(() => { });

        // Controllo degli aggiornamenti ogni volta che la PWA torna in primo piano (es. su iPhone)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            reg.update().catch(() => { });
          }
        });

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                if (typeof showToast === 'function') {
                  showToast('Nuova versione applicata! Aggiornamento in corso...', 'info', {
                    actionLabel: 'Aggiorna ora',
                    duration: 6000,
                    onAction: () => window.location.reload()
                  });
                }
              }
            });
          }
        });
      }).catch(err => console.error('Registrazione SW fallita:', err));
    });
  }

  const MONTH_NAMES_IT = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
  ];

  function formatDateKey(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getDatesInRange(startStr, endStr) {
    if (!startStr) return [];
    const finalEndStr = (endStr && endStr >= startStr) ? endStr : startStr;
    const dates = [];
    const [sy, sm, sd] = startStr.split('-').map(Number);
    const [ey, em, ed] = finalEndStr.split('-').map(Number);
    const curr = new Date(sy, sm - 1, sd);
    const last = new Date(ey, em - 1, ed);

    while (curr <= last) {
      dates.push(formatDateKey(curr));
      curr.setDate(curr.getDate() + 1);
    }
    return dates;
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function isAnyModalOpen() {
    return document.querySelectorAll('.modal-backdrop:not(.hidden)').length > 0;
  }

  // Trova la posizione in cui reinserire un elemento ripristinato (undo) confrontando
  // gli id (che incorporano un timestamp di creazione), invece di affidarsi a un indice
  // catturato al momento della cancellazione: un indice numerico diventerebbe scorretto
  // se, durante la finestra di annullamento, l'array viene modificato da altre azioni.
  function findInsertionIndexById(list, item) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id > item.id) return i;
    }
    return list.length;
  }

  function showToast(msg, type = 'success', options = null) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const msgSpan = document.createElement('span');
    msgSpan.textContent = msg;
    toast.appendChild(msgSpan);

    if (options && options.actionLabel && options.onAction) {
      let actioned = false;
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'toast-action-btn';
      actionBtn.textContent = options.actionLabel;
      actionBtn.addEventListener('click', () => {
        actioned = true;
        options.onAction();
        toast.remove();
      });
      toast.appendChild(actionBtn);
      container.appendChild(toast);
      setTimeout(() => {
        if (!actioned && options.onExpire) options.onExpire();
        toast.remove();
      }, options.duration || 5000);
    } else {
      container.appendChild(toast);
      setTimeout(() => {
        toast.remove();
      }, 3000);
    }
  }

  // Notifiche locali (opt-in, foreground/tab-recente): non è push in background reale.
  function getNotifiedSet() {
    try { return new Set(JSON.parse(localStorage.getItem(NOTIFIED_STORAGE_KEY) || '[]')); }
    catch (e) { return new Set(); }
  }

  function markNotified(tag) {
    const set = getNotifiedSet();
    set.add(tag);
    localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(Array.from(set)));
  }

  function checkAndNotify() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const todayStr = formatDateKey(new Date());
    const notified = getNotifiedSet();

    const showNotif = (title, body, tag) => {
      if (notified.has(tag)) return;
      if (navigator.serviceWorker) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification(title, {
          body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag
        }));
      } else {
        new Notification(title, { body, icon: 'icons/icon-192.png' });
      }
      markNotified(tag);
    };

    AppState.events.filter(e => {
      const start = e.date;
      const end = e.dateEnd || e.date;
      return start <= todayStr && end >= todayStr;
    }).forEach(e => {
      showNotif('Evento di oggi', `${e.title}${e.timeStart ? ' alle ' + e.timeStart : ''}`, `event_${e.id}_${todayStr}`);
    });

    AppState.tasks
      .filter(t => t.status !== 'completed' && t.urgency === 'critical' && t.dueDate && t.dueDate <= todayStr)
      .forEach(t => {
        const label = t.dueDate < todayStr ? `${t.title} (scaduto)` : `${t.title} (scade oggi)`;
        showNotif('Memo critico', label, `task_${t.id}_${todayStr}`);
      });
  }

  // --- Web Push Helpers per Notifiche ad App Chiusa ---
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function setupPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('Le notifiche Push non sono supportate su questo browser.');
    }

    if (!AppState.token) {
      showToast('Accedi al tuo account per abilitare le notifiche Push ad app chiusa.', 'info');
      return;
    }

    const res = await fetch(`${API_BASE_URL}/api/push/vapid-public-key`);
    if (!res.ok) throw new Error('Servizio Notifiche Push temporaneamente non disponibile.');
    const data = await res.json();
    if (!data.success || !data.publicKey) throw new Error('Chiave pubblica VAPID non trovata.');

    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
      const convertedKey = urlBase64ToUint8Array(data.publicKey);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
      });
    }

    const subRes = await fetch(`${API_BASE_URL}/api/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({ subscription })
    });

    if (subRes.ok) {
      showToast('Notifiche Push in background attivate con successo!');
    }
  }

  async function testPushNotification() {
    if (!AppState.token) {
      showToast('Accedi al tuo account per effettuare il test delle notifiche.', 'danger');
      return;
    }

    if (Notification.permission !== 'granted') {
      showToast('Abilita prima le Notifiche Push dal menu.', 'info');
      return;
    }

    showToast('Invio notifica di prova in corso...');

    try {
      await setupPushNotifications();

      const res = await fetch(`${API_BASE_URL}/api/push/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AppState.token}`
        }
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.message);
      } else {
        showToast(data.error || 'Errore invio notifica di prova.', 'danger');
      }
    } catch (e) {
      showToast(e.message || 'Errore durante la prova notifiche.', 'danger');
    }
  }

  // ==========================================
  // 1. STATO GLOBALE (AppState) & REDIS SYNC
  // ==========================================
  const AppState = {
    currentDate: new Date(),
    selectedDate: null,
    currentView: 'month',
    sidebarTab: 'undated',
    filterCategory: 'all',
    filterUrgency: 'all',
    catalogStatusFilter: 'all',
    searchQuery: '',

    events: [],
    tasks: [],
    tombstones: [], // { id, deletedAt } - cancellazioni persistite e sincronizzate, per propagare i delete tra dispositivi

    token: null,
    username: null,
    userRole: null,
    displayName: null,
    avatarUrl: null,
    syncIntervalId: null,
    hasPendingSync: false,
    recentlyDeletedIds: new Map(), // finestra breve in-memory per bloccare la resurrezione durante l'undo

    listeners: [],

    subscribe(listener) {
      this.listeners.push(listener);
    },

    notify() {
      this.listeners.forEach(fn => fn(this));
    },

    getUserEventsStorageKey() {
      const uname = this.username || 'guest';
      return `planner_${uname}_events_v1`;
    },

    getUserTasksStorageKey() {
      const uname = this.username || 'guest';
      return `planner_${uname}_tasks_v1`;
    },

    getUserTombstonesStorageKey() {
      const uname = this.username || 'guest';
      return `planner_${uname}_tombstones_v1`;
    },

    getUserCycleSettingsStorageKey() {
      const uname = this.username || 'guest';
      return `planner_${uname}_cycle_settings_v1`;
    },

    getUserCycleLogsStorageKey() {
      const uname = this.username || 'guest';
      return `planner_${uname}_cycle_logs_v1`;
    },

    init() {
      this.loadFromStorage();
      this.checkAuthSession();
    },

    loadFromStorage() {
      try {
        this.token = localStorage.getItem(STORAGE_KEY_TOKEN) || null;
        this.username = localStorage.getItem(STORAGE_KEY_USER) || null;
        this.userRole = localStorage.getItem(STORAGE_KEY_ROLE) || null;
        this.displayName = localStorage.getItem(STORAGE_KEY_DISPLAY_NAME) || null;
        this.avatarUrl = localStorage.getItem(STORAGE_KEY_AVATAR) || null;

        if (this.username) {
          const storedEvents = localStorage.getItem(this.getUserEventsStorageKey());
          const storedTasks = localStorage.getItem(this.getUserTasksStorageKey());
          const storedTombstones = localStorage.getItem(this.getUserTombstonesStorageKey());
          const storedCycleSettings = localStorage.getItem(this.getUserCycleSettingsStorageKey());
          const storedCycleLogs = localStorage.getItem(this.getUserCycleLogsStorageKey());

          this.events = storedEvents ? JSON.parse(storedEvents) : [];
          this.tasks = storedTasks ? JSON.parse(storedTasks) : [];
          this.tombstones = storedTombstones ? JSON.parse(storedTombstones) : [];
          this.cycleSettings = storedCycleSettings ? JSON.parse(storedCycleSettings) : (window.ChronosCycle ? { ...window.ChronosCycle.DEFAULT_CYCLE_SETTINGS } : {});
          this.cycleLogs = storedCycleLogs ? JSON.parse(storedCycleLogs) : {};

          this.pruneTombstones();
        } else {
          this.events = [];
          this.tasks = [];
          this.tombstones = [];
          this.cycleSettings = window.ChronosCycle ? { ...window.ChronosCycle.DEFAULT_CYCLE_SETTINGS } : {};
          this.cycleLogs = {};
        }
      } catch (e) {
        console.error('Errore caricamento localStorage:', e);
        this.events = [];
        this.tasks = [];
        this.tombstones = [];
        this.cycleSettings = window.ChronosCycle ? { ...window.ChronosCycle.DEFAULT_CYCLE_SETTINGS } : {};
        this.cycleLogs = {};
      }
    },

    // Rimuove i tombstone più vecchi di 30 giorni per non far crescere la lista all'infinito.
    pruneTombstones() {
      const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
      this.tombstones = this.tombstones.filter(t => (t.deletedAt || 0) >= cutoff);
    },

    saveToStorage(skipRedisSync = false) {
      try {
        if (this.username) {
          localStorage.setItem(this.getUserEventsStorageKey(), JSON.stringify(this.events));
          localStorage.setItem(this.getUserTasksStorageKey(), JSON.stringify(this.tasks));
          localStorage.setItem(this.getUserTombstonesStorageKey(), JSON.stringify(this.tombstones));
          localStorage.setItem(this.getUserCycleSettingsStorageKey(), JSON.stringify(this.cycleSettings || {}));
          localStorage.setItem(this.getUserCycleLogsStorageKey(), JSON.stringify(this.cycleLogs || {}));
        }
      } catch (e) {
        console.error('Errore salvataggio localStorage:', e);
      }

      if (!skipRedisSync && this.token) {
        this.pushToRedis();
      }
      this.notify();
    },

    updateCycleSettings(newSettings) {
      this.cycleSettings = { ...this.cycleSettings, ...newSettings };
      this.saveToStorage();
      showToast('Impostazioni ciclo aggiornate.');
    },

    setCycleLog(dateStr, logData) {
      if (!this.cycleLogs) this.cycleLogs = {};
      this.cycleLogs[dateStr] = { ...logData, updatedAt: Date.now() };
      this.saveToStorage();
      showToast('Registro del giorno salvato.');
    },

    getCycleLog(dateStr) {
      return (this.cycleLogs && this.cycleLogs[dateStr]) ? this.cycleLogs[dateStr] : null;
    },

      if (!skipRedisSync && this.token) {
        this.pushToRedis();
      }
      this.notify();
    },

    loadDemoData() {
      const todayStr = formatDateKey(new Date());
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = formatDateKey(tomorrow);

      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 5);
      const nextWeekStr = formatDateKey(nextWeek);

      this.events = [
        {
          id: 'evt_demo_1',
          title: 'Riunione di Progetto',
          date: todayStr,
          timeStart: '10:00',
          timeEnd: '11:30',
          category: 'lavoro',
          description: 'Revisione deliverable con il team'
        },
        {
          id: 'evt_demo_2',
          title: 'Visita Medica',
          date: tomorrowStr,
          timeStart: '15:00',
          timeEnd: '16:00',
          category: 'salute',
          description: 'Appuntamento in clinica'
        }
      ];

      this.tasks = [
        {
          id: 'task_demo_1',
          title: 'Revisione contabilità e fatture',
          urgency: 'critical',
          category: 'finanza',
          dueDate: null,
          status: 'todo',
          description: 'Controllare scadenze F24 e invio fatture.'
        },
        {
          id: 'task_demo_2',
          title: 'Preparare presentazione cliente',
          urgency: 'high',
          category: 'lavoro',
          dueDate: todayStr,
          status: 'in_progress',
          description: 'Includere grafici di performance.'
        }
      ];

      this.saveToStorage(true);
    },

    checkAuthSession() {
      if (localStorage.getItem(STORAGE_KEY_GUEST_MODE) === '1') {
        this.username = GUEST_USERNAME;
        this.token = null;
        this.userRole = 'client';
        this.displayName = 'Ospite';
        this.loadFromStorage();
        this.updateAuthUI(true);
        return;
      }
      if (this.token && this.username) {
        fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${this.token}` }
        })
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data && data.success && data.user) {
              this.userRole = data.user.role || 'client';
              this.displayName = data.user.displayName || data.user.username;
              if (data.user.avatarDataUrl) {
                this.avatarUrl = data.user.avatarDataUrl;
                localStorage.setItem(STORAGE_KEY_AVATAR, this.avatarUrl);
              }
              localStorage.setItem(STORAGE_KEY_ROLE, this.userRole);
              localStorage.setItem(STORAGE_KEY_DISPLAY_NAME, this.displayName);

              this.loadFromStorage();
              this.updateAuthUI(true);
              this.pullFromRedis();
              this.startRedisPolling();
            } else {
              this.updateAuthUI(true);
            }
          })
          .catch(() => {
            this.updateAuthUI(true);
          });
      } else {
        this.updateAuthUI(false);
      }
    },

    setSession(username, token, role = 'client', displayName = '', avatarDataUrl = null) {
      this.username = username;
      this.token = token;
      this.userRole = role || (username === 'admin' ? 'admin' : 'client');
      this.displayName = displayName || username;
      this.avatarUrl = avatarDataUrl || null;

      localStorage.setItem(STORAGE_KEY_USER, username);
      localStorage.setItem(STORAGE_KEY_TOKEN, token);
      localStorage.setItem(STORAGE_KEY_ROLE, this.userRole);
      localStorage.setItem(STORAGE_KEY_DISPLAY_NAME, this.displayName);
      if (this.avatarUrl) {
        localStorage.setItem(STORAGE_KEY_AVATAR, this.avatarUrl);
      } else {
        localStorage.removeItem(STORAGE_KEY_AVATAR);
      }

      this.loadFromStorage();
      this.updateAuthUI(true);

      this.pullFromRedis();
      this.startRedisPolling();

      const badgeRole = this.userRole === 'admin' ? 'Amministratore' : 'Cliente';
      showToast(`Benvenuto ${this.displayName} (${badgeRole})`);
    },

    enterGuestMode() {
      this.username = GUEST_USERNAME;
      this.token = null;
      this.userRole = 'client';
      this.displayName = 'Ospite';
      this.avatarUrl = null;

      localStorage.setItem(STORAGE_KEY_GUEST_MODE, '1');
      localStorage.setItem(STORAGE_KEY_USER, GUEST_USERNAME);
      localStorage.removeItem(STORAGE_KEY_TOKEN);
      localStorage.setItem(STORAGE_KEY_ROLE, this.userRole);
      localStorage.setItem(STORAGE_KEY_DISPLAY_NAME, this.displayName);
      localStorage.removeItem(STORAGE_KEY_AVATAR);

      this.loadFromStorage();
      this.updateAuthUI(true);
      showToast('Modalità ospite attiva: i dati restano solo su questo dispositivo.');
    },

    logout() {
      this.events = [];
      this.tasks = [];

      this.username = null;
      this.token = null;
      this.userRole = null;
      this.displayName = null;
      this.avatarUrl = null;

      localStorage.removeItem(STORAGE_KEY_USER);
      localStorage.removeItem(STORAGE_KEY_TOKEN);
      localStorage.removeItem(STORAGE_KEY_ROLE);
      localStorage.removeItem(STORAGE_KEY_DISPLAY_NAME);
      localStorage.removeItem(STORAGE_KEY_AVATAR);
      localStorage.removeItem(STORAGE_KEY_GUEST_MODE);

      if (this.syncIntervalId) clearInterval(this.syncIntervalId);
      this.updateAuthUI(false);
      this.notify();
      showToast('Disconnessione effettuata.', 'danger');
    },

    updateAuthUI(isLoggedIn) {
      const initialOverlay = document.getElementById('initialLoginOverlay');
      const openBtn = document.getElementById('openAuthModalBtn');
      const badge = document.getElementById('userInfoBadge');
      const label = document.getElementById('currentUsernameLabel');
      const roleBadge = document.getElementById('userRoleBadge');
      const openAdminBtn = document.getElementById('openAdminPanelBtn');

      const userAvatarImg = document.getElementById('userAvatarImg');
      const userAvatarCircle = document.getElementById('userAvatarCircle');
      const dropdownAvatarImg = document.getElementById('dropdownAvatarImg');
      const dropdownAvatarCircle = document.getElementById('dropdownAvatarCircle');
      const dropdownDisplayName = document.getElementById('dropdownDisplayName');
      const dropdownRoleText = document.getElementById('dropdownRoleText');

      if (isLoggedIn) {
        if (initialOverlay) initialOverlay.classList.add('hidden');
        if (openBtn) openBtn.classList.add('hidden');
        if (badge) badge.classList.remove('hidden');

        const nameStr = this.displayName || this.username || 'Utente';
        if (label) label.textContent = nameStr;
        if (dropdownDisplayName) dropdownDisplayName.textContent = nameStr;

        const roleTitle = this.userRole === 'admin' ? 'Amministratore' : 'Cliente Standard';
        if (dropdownRoleText) dropdownRoleText.textContent = roleTitle;

        // Gestione Foto Profilo vs Iniziale
        if (this.avatarUrl) {
          if (userAvatarImg) {
            userAvatarImg.src = this.avatarUrl;
            userAvatarImg.classList.remove('hidden');
          }
          if (userAvatarCircle) userAvatarCircle.classList.add('hidden');

          if (dropdownAvatarImg) {
            dropdownAvatarImg.src = this.avatarUrl;
            dropdownAvatarImg.classList.remove('hidden');
          }
          if (dropdownAvatarCircle) dropdownAvatarCircle.classList.add('hidden');
        } else {
          const initialChar = nameStr.charAt(0).toUpperCase();
          if (userAvatarImg) userAvatarImg.classList.add('hidden');
          if (userAvatarCircle) {
            userAvatarCircle.textContent = initialChar;
            userAvatarCircle.classList.remove('hidden');
          }

          if (dropdownAvatarImg) dropdownAvatarImg.classList.add('hidden');
          if (dropdownAvatarCircle) {
            dropdownAvatarCircle.textContent = initialChar;
            dropdownAvatarCircle.classList.remove('hidden');
          }
        }

        if (roleBadge) {
          if (this.userRole === 'admin') {
            roleBadge.textContent = 'Admin';
            roleBadge.className = 'role-pill admin';
          } else {
            roleBadge.textContent = 'Cliente';
            roleBadge.className = 'role-pill client';
          }
        }

        if (openAdminBtn) {
          if (this.userRole === 'admin') {
            openAdminBtn.classList.remove('hidden');
          } else {
            openAdminBtn.classList.add('hidden');
          }
        }
      } else {
        if (initialOverlay) initialOverlay.classList.remove('hidden');
        if (openBtn) openBtn.classList.remove('hidden');
        if (badge) badge.classList.add('hidden');
        if (openAdminBtn) openAdminBtn.classList.add('hidden');
      }
    },

    startRedisPolling() {
      if (this.syncIntervalId) clearInterval(this.syncIntervalId);
      this.syncIntervalId = setInterval(() => {
        if (this.token) this.pullFromRedis();
      }, 8000);
    },

    pushToRedis() {
      if (!this.token) return;
      fetch(`${API_BASE_URL}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          events: this.events,
          tasks: this.tasks,
          tombstones: this.tombstones,
          cycleSettings: this.cycleSettings,
          cycleLogs: this.cycleLogs
        })
      })
        .then(res => { if (!res.ok) throw new Error('sync failed'); this.hasPendingSync = false; })
        .catch(() => { this.hasPendingSync = true; });
    },

    // Unisce la lista locale con quella remota tenendo per ogni id la versione con updatedAt più recente.
    // Rispetta le cancellazioni locali ancora in sospeso (recentlyDeletedIds) per evitare che un poll
    // "resusciti" un elemento appena eliminato dall'utente prima che la cancellazione sia stata pushata.
    // Le cancellazioni già confermate sono invece propagate tramite i tombstone persistiti (vedi pullFromRedis).
    mergeById(localList, remoteList) {
      const map = new Map();
      localList.forEach(item => map.set(item.id, item));
      remoteList.forEach(remoteItem => {
        if (this.recentlyDeletedIds.has(remoteItem.id)) return;
        const localItem = map.get(remoteItem.id);
        if (!localItem) {
          map.set(remoteItem.id, remoteItem);
        } else if ((remoteItem.updatedAt || 0) > (localItem.updatedAt || 0)) {
          map.set(remoteItem.id, remoteItem);
        }
      });
      return Array.from(map.values());
    },

    // Unisce i tombstone locali e remoti (unione per id) cosi' che una cancellazione fatta
    // su un dispositivo si propaghi anche agli altri, invece di essere "resuscitata" al
    // prossimo pull perche' l'elemento e' ancora presente nella copia locale di un altro device.
    mergeTombstones(localTombstones, remoteTombstones) {
      const map = new Map();
      localTombstones.forEach(t => map.set(t.id, t));
      remoteTombstones.forEach(t => {
        if (!map.has(t.id)) map.set(t.id, t);
      });
      return Array.from(map.values());
    },

    pullFromRedis() {
      if (!this.token) return;
      if (isAnyModalOpen()) return;
      fetch(`${API_BASE_URL}/api/sync`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.success) {
            this.tombstones = this.mergeTombstones(this.tombstones, data.tombstones || []);
            const deletedIds = new Set(this.tombstones.map(t => t.id));

            const mergedEvents = this.mergeById(this.events, data.events || []);
            const mergedTasks = this.mergeById(this.tasks, data.tasks || []);
            this.events = mergedEvents.filter(e => !deletedIds.has(e.id));
            this.tasks = mergedTasks.filter(t => !deletedIds.has(t.id));

            if (data.cycleSettings) {
              this.cycleSettings = { ...this.cycleSettings, ...data.cycleSettings };
            }
            if (data.cycleLogs) {
              this.cycleLogs = { ...this.cycleLogs, ...data.cycleLogs };
            }

            this.pruneTombstones();
            this.saveToStorage(true);
          }
        })
        .catch(() => { });
    },

    // Operazioni Eventi
    addEvent(eventData) {
      const newEvent = { id: 'evt_' + Date.now(), ...eventData, updatedAt: Date.now() };
      this.events.push(newEvent);
      this.saveToStorage();
      showToast('Evento creato con successo.');
      return newEvent;
    },

    updateEvent(id, eventData) {
      const idx = this.events.findIndex(e => e.id === id);
      if (idx !== -1) {
        this.events[idx] = { ...this.events[idx], ...eventData, updatedAt: Date.now() };
        this.saveToStorage();
        showToast('Evento aggiornato.');
      }
    },

    deleteEvent(id) {
      const idx = this.events.findIndex(e => e.id === id);
      if (idx === -1) return;
      const removed = this.events[idx];
      this.events.splice(idx, 1);
      this.recentlyDeletedIds.set(id, Date.now());
      this.notify();

      showToast('Evento eliminato.', 'danger', {
        actionLabel: 'Annulla',
        duration: 5000,
        onAction: () => {
          const insertAt = findInsertionIndexById(this.events, removed);
          this.events.splice(insertAt, 0, removed);
          this.recentlyDeletedIds.delete(id);
          this.saveToStorage();
        },
        onExpire: () => {
          this.tombstones.push({ id, deletedAt: Date.now() });
          this.saveToStorage();
          setTimeout(() => this.recentlyDeletedIds.delete(id), 20000);
        }
      });
    },

    // Operazioni Memo / Task
    addTask(taskData) {
      const newTask = { id: 'task_' + Date.now(), status: 'todo', ...taskData, updatedAt: Date.now() };
      this.tasks.push(newTask);
      this.saveToStorage();
      showToast('Memo creato con successo.');
      return newTask;
    },

    updateTask(id, taskData) {
      const idx = this.tasks.findIndex(t => t.id === id);
      if (idx !== -1) {
        this.tasks[idx] = { ...this.tasks[idx], ...taskData, updatedAt: Date.now() };
        this.saveToStorage();
        showToast('Memo aggiornato.');
      }
    },

    deleteTask(id) {
      const idx = this.tasks.findIndex(t => t.id === id);
      if (idx === -1) return;
      const removed = this.tasks[idx];
      this.tasks.splice(idx, 1);
      this.recentlyDeletedIds.set(id, Date.now());
      this.notify();

      showToast('Memo eliminato.', 'danger', {
        actionLabel: 'Annulla',
        duration: 5000,
        onAction: () => {
          const insertAt = findInsertionIndexById(this.tasks, removed);
          this.tasks.splice(insertAt, 0, removed);
          this.recentlyDeletedIds.delete(id);
          this.saveToStorage();
        },
        onExpire: () => {
          this.tombstones.push({ id, deletedAt: Date.now() });
          this.saveToStorage();
          setTimeout(() => this.recentlyDeletedIds.delete(id), 20000);
        }
      });
    },

    toggleTaskStatus(id) {
      const task = this.tasks.find(t => t.id === id);
      if (task) {
        task.status = task.status === 'completed' ? 'todo' : 'completed';
        task.updatedAt = Date.now();
        this.saveToStorage();
      }
    },

    assignTaskDate(id, dateStr) {
      const task = this.tasks.find(t => t.id === id);
      if (task) {
        task.dueDate = dateStr;
        task.updatedAt = Date.now();
        this.saveToStorage();
      }
    },

    exportData() {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
        version: "1.0",
        exportDate: new Date().toISOString(),
        events: this.events,
        tasks: this.tasks
      }, null, 2));

      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `chronos_backup_${formatDateKey(new Date())}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast('Backup JSON scaricato.');
    },

    importData(jsonContent) {
      try {
        const parsed = JSON.parse(jsonContent);
        if (Array.isArray(parsed.events) && Array.isArray(parsed.tasks)) {
          this.events = parsed.events;
          this.tasks = parsed.tasks;
          this.saveToStorage();
          showToast('Dati importati con successo.');
        } else {
          alert('File backup non valido.');
        }
      } catch (e) {
        alert('Errore lettura JSON: ' + e.message);
      }
    },

    getFilteredTasks() {
      return this.tasks.filter(task => {
        if (this.sidebarTab === 'undated' && task.dueDate !== null && task.dueDate !== '') {
          return false;
        }
        if (this.filterUrgency !== 'all' && task.urgency !== this.filterUrgency) {
          return false;
        }
        if (this.filterCategory !== 'all' && task.category !== this.filterCategory) {
          return false;
        }
        if (this.searchQuery.trim() !== '') {
          const query = this.searchQuery.toLowerCase();
          const matchTitle = task.title.toLowerCase().includes(query);
          const matchDesc = (task.description || '').toLowerCase().includes(query);
          if (!matchTitle && !matchDesc) return false;
        }
        return true;
      });
    },

    getUrgencyCounts() {
      const counts = { critical: 0, high: 0, medium: 0, low: 0 };
      this.tasks.forEach(task => {
        if (task.urgency && counts.hasOwnProperty(task.urgency)) {
          counts[task.urgency]++;
        }
      });
      return counts;
    }
  };

  // ==========================================
  // 2. CALENDAR ENGINE
  // ==========================================
  // ==========================================
  // 2. CALENDAR ENGINE & MEMO CATALOG ENGINE
  // ==========================================
  function renderCalendar() {
    const currentMonthYearLabel = document.getElementById('currentMonthYearLabel');
    const calendarGrid = document.getElementById('calendarGrid');
    const agendaList = document.getElementById('agendaList');

    const viewMonthContainer = document.getElementById('calendarViewContainer');
    const viewAgendaContainer = document.getElementById('agendaViewContainer');
    const viewMemoContainer = document.getElementById('memoCatalogViewContainer');
    const viewCycleContainer = document.getElementById('cycleViewContainer');

    const currDate = AppState.currentDate;
    const year = currDate.getFullYear();
    const month = currDate.getMonth();

    if (currentMonthYearLabel) {
      currentMonthYearLabel.textContent = `${MONTH_NAMES_IT[month]} ${year}`;
    }

    const todayBtn = document.getElementById('todayBtn');
    if (todayBtn) {
      const now = new Date();
      const todayDay = now.getDate();
      const todayMonthName = MONTH_NAMES_IT[now.getMonth()];
      todayBtn.textContent = `${todayDay} ${todayMonthName}`;
      todayBtn.title = `Torna a Oggi (${todayDay} ${todayMonthName})`;
    }

    if (AppState.currentView === 'month') {
      if (viewMonthContainer) viewMonthContainer.classList.remove('hidden');
      if (viewAgendaContainer) viewAgendaContainer.classList.add('hidden');
      if (viewMemoContainer) viewMemoContainer.classList.add('hidden');
      if (viewCycleContainer) viewCycleContainer.classList.add('hidden');
      renderMonthGrid(calendarGrid, year, month);
    } else if (AppState.currentView === 'agenda') {
      if (viewMonthContainer) viewMonthContainer.classList.add('hidden');
      if (viewAgendaContainer) viewAgendaContainer.classList.remove('hidden');
      if (viewMemoContainer) viewMemoContainer.classList.add('hidden');
      if (viewCycleContainer) viewCycleContainer.classList.add('hidden');
      renderAgendaList(agendaList);
    } else if (AppState.currentView === 'memo') {
      if (viewMonthContainer) viewMonthContainer.classList.add('hidden');
      if (viewAgendaContainer) viewAgendaContainer.classList.add('hidden');
      if (viewMemoContainer) viewMemoContainer.classList.remove('hidden');
      if (viewCycleContainer) viewCycleContainer.classList.add('hidden');
      renderMemoCatalog();
    } else if (AppState.currentView === 'cycle') {
      if (viewMonthContainer) viewMonthContainer.classList.add('hidden');
      if (viewAgendaContainer) viewAgendaContainer.classList.add('hidden');
      if (viewMemoContainer) viewMemoContainer.classList.add('hidden');
      if (viewCycleContainer) viewCycleContainer.classList.remove('hidden');
      renderCycleView();
    }
  }

  let currentCycleCalendarDate = new Date();
  let selectedCycleDateStr = formatDateKey(new Date());

  function renderCycleView() {
    const unconfiguredBanner = document.getElementById('cycleUnconfiguredBanner');
    const dashboard = document.getElementById('cycleDashboard');
    if (!unconfiguredBanner || !dashboard) return;

    const settings = AppState.cycleSettings;
    if (!settings || !settings.enabled || !settings.lastPeriodStart) {
      unconfiguredBanner.classList.remove('hidden');
      dashboard.classList.add('hidden');
      return;
    }

    unconfiguredBanner.classList.add('hidden');
    dashboard.classList.remove('hidden');

    const todayState = window.ChronosCycle ? window.ChronosCycle.calculateCycleState(new Date(), settings) : { enabled: false };

    // Header badge
    const phaseBadge = document.getElementById('cycleCurrentPhaseBadge');
    if (phaseBadge && todayState.phase) {
      phaseBadge.textContent = todayState.phase.label;
      phaseBadge.className = `phase-badge ${todayState.phase.badgeClass}`;
    }

    // Card 1
    const phaseIcon = document.getElementById('cyclePhaseIcon');
    const dayTitle = document.getElementById('cycleDayTitle');
    const phaseDesc = document.getElementById('cyclePhaseDesc');
    if (phaseIcon) phaseIcon.textContent = todayState.phase ? todayState.phase.icon : '🌸';
    if (dayTitle) dayTitle.textContent = `Giorno ${todayState.dayOfCycle || 1} del ciclo`;
    if (phaseDesc) phaseDesc.textContent = todayState.phase ? todayState.phase.name + ' in corso' : '';

    // Card 2
    const countdownTitle = document.getElementById('cycleNextPeriodCountdown');
    const countdownSub = document.getElementById('cycleNextPeriodSub');
    if (countdownTitle) countdownTitle.textContent = `Prossimo ciclo tra ${todayState.daysUntilNextPeriod || 0} giorni`;
    if (countdownSub) countdownSub.textContent = `Inizio previsto: ${todayState.nextPeriodStartStr || '--'}`;

    // Card 3
    const tipTitle = document.getElementById('cycleTipTitle');
    const tipBody = document.getElementById('cycleTipBody');
    if (tipTitle) tipTitle.textContent = todayState.phase ? todayState.phase.label : 'Consiglio Benessere';
    if (tipBody) tipBody.textContent = todayState.phase ? todayState.phase.tip : 'Mantieni una buona idratazione e rispetta i ritmi del tuo corpo.';

    renderCycleCalendarGrid();
    renderCycleLogForm(selectedCycleDateStr);
  }

  function renderCycleCalendarGrid() {
    const grid = document.getElementById('cycleCalendarGrid');
    const label = document.getElementById('cycleMonthYearLabel');
    if (!grid) return;
    grid.innerHTML = '';

    const currDate = currentCycleCalendarDate;
    const year = currDate.getFullYear();
    const month = currDate.getMonth();

    if (label) label.textContent = `${MONTH_NAMES_IT[month]} ${year}`;

    const firstDayObj = new Date(year, month, 1);
    let startingDayOfWeek = firstDayObj.getDay() - 1;
    if (startingDayOfWeek === -1) startingDayOfWeek = 6;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const totalCells = (startingDayOfWeek + daysInMonth) > 35 ? 42 : 35;
    let dayCounter = 1;
    let nextMonthDayCounter = 1;

    const todayStr = formatDateKey(new Date());

    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('div');
      cell.className = 'cycle-day-cell';

      let cellDateStr = '';
      let isOtherMonth = false;
      let displayDayNum = '';

      if (i < startingDayOfWeek) {
        isOtherMonth = true;
        const prevDay = daysInPrevMonth - (startingDayOfWeek - 1 - i);
        displayDayNum = prevDay;
        cellDateStr = formatDateKey(new Date(year, month - 1, prevDay));
      } else if (dayCounter <= daysInMonth) {
        displayDayNum = dayCounter;
        cellDateStr = formatDateKey(new Date(year, month, dayCounter));
        dayCounter++;
      } else {
        isOtherMonth = true;
        displayDayNum = nextMonthDayCounter;
        cellDateStr = formatDateKey(new Date(year, month + 1, nextMonthDayCounter));
        nextMonthDayCounter++;
      }

      if (isOtherMonth) cell.classList.add('other-month');
      if (cellDateStr === todayStr) cell.classList.add('today');
      if (cellDateStr === selectedCycleDateStr) cell.classList.add('selected');

      const state = window.ChronosCycle ? window.ChronosCycle.calculateCycleState(cellDateStr, AppState.cycleSettings) : null;
      if (state && state.enabled && state.phase) {
        cell.classList.add(state.phase.badgeClass);
      }

      const numSpan = document.createElement('span');
      numSpan.className = 'day-number';
      numSpan.textContent = displayDayNum;
      cell.appendChild(numSpan);

      const existingLog = AppState.getCycleLog(cellDateStr);
      if (existingLog && (existingLog.flow !== 'none' || (existingLog.symptoms && existingLog.symptoms.length > 0) || existingLog.mood)) {
        const logDot = document.createElement('span');
        logDot.textContent = existingLog.flow === 'heavy' ? '🩸' : (existingLog.flow === 'medium' ? '💧' : '✍️');
        logDot.style.fontSize = '0.7rem';
        cell.appendChild(logDot);
      }

      cell.addEventListener('click', () => {
        selectedCycleDateStr = cellDateStr;
        renderCycleCalendarGrid();
        renderCycleLogForm(selectedCycleDateStr);
      });

      grid.appendChild(cell);
    }
  }

  function renderCycleLogForm(dateStr) {
    const titleEl = document.getElementById('cycleSelectedDayTitle');
    const phaseEl = document.getElementById('cycleSelectedDayPhase');
    const flowBox = document.getElementById('flowSelector');
    const moodBox = document.getElementById('moodSelector');
    const symptomsBox = document.getElementById('symptomsGrid');
    const tempInput = document.getElementById('cycleTempInput');
    const notesInput = document.getElementById('cycleNotesInput');

    if (!titleEl || !flowBox || !moodBox || !symptomsBox || !window.ChronosCycle) return;

    const targetDateObj = window.ChronosCycle.parseDateKey(dateStr);
    const dayFormatted = targetDateObj ? `${targetDateObj.getDate()} ${MONTH_NAMES_IT[targetDateObj.getMonth()]} ${targetDateObj.getFullYear()}` : dateStr;
    titleEl.textContent = `Registro del ${dayFormatted}`;

    const state = window.ChronosCycle.calculateCycleState(dateStr, AppState.cycleSettings);
    if (phaseEl && state.enabled && state.phase) {
      phaseEl.textContent = state.phase.name;
      phaseEl.className = `phase-pill ${state.phase.badgeClass}`;
    }

    const log = AppState.getCycleLog(dateStr) || {};
    let currentFlow = log.flow || 'none';
    let currentMood = log.mood || '';
    let currentSymptoms = new Set(log.symptoms || []);

    // Flow buttons
    flowBox.innerHTML = '';
    window.ChronosCycle.FLOW_LEVELS.forEach(fl => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `flow-btn ${currentFlow === fl.id ? 'selected' : ''}`;
      btn.textContent = `${fl.icon} ${fl.label}`;
      btn.addEventListener('click', () => {
        currentFlow = fl.id;
        flowBox.querySelectorAll('.flow-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      flowBox.appendChild(btn);
    });

    // Mood buttons
    moodBox.innerHTML = '';
    window.ChronosCycle.MOODS_LIST.forEach(m => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mood-btn ${currentMood === m.id ? 'selected' : ''}`;
      btn.textContent = `${m.icon} ${m.label}`;
      btn.addEventListener('click', () => {
        currentMood = currentMood === m.id ? '' : m.id;
        moodBox.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
        if (currentMood) btn.classList.add('selected');
      });
      moodBox.appendChild(btn);
    });

    // Symptoms pills
    symptomsBox.innerHTML = '';
    window.ChronosCycle.SYMPTOMS_LIST.forEach(sym => {
      const pill = document.createElement('div');
      pill.className = `symptom-pill ${currentSymptoms.has(sym.id) ? 'selected' : ''}`;
      pill.innerHTML = `<span>${sym.icon}</span><span>${sym.label}</span>`;
      pill.addEventListener('click', () => {
        if (currentSymptoms.has(sym.id)) {
          currentSymptoms.delete(sym.id);
          pill.classList.remove('selected');
        } else {
          currentSymptoms.add(sym.id);
          pill.classList.add('selected');
        }
      });
      symptomsBox.appendChild(pill);
    });

    if (tempInput) tempInput.value = log.temperature || '';
    if (notesInput) notesInput.value = log.notes || '';

    const form = document.getElementById('cycleLogForm');
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const tempVal = tempInput ? parseFloat(tempInput.value) : null;
        const notesVal = notesInput ? notesInput.value.trim() : '';

        AppState.setCycleLog(dateStr, {
          flow: currentFlow,
          mood: currentMood,
          symptoms: Array.from(currentSymptoms),
          temperature: isNaN(tempVal) ? null : tempVal,
          notes: notesVal
        });

        renderCycleCalendarGrid();
      };
    }
  }

  function renderMonthGrid(container, year, month) {
    if (!container) return;
    container.innerHTML = '';

    const todayStr = formatDateKey(new Date());

    const firstDayObj = new Date(year, month, 1);
    let startingDayOfWeek = firstDayObj.getDay() - 1;
    if (startingDayOfWeek === -1) startingDayOfWeek = 6;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const totalCells = (startingDayOfWeek + daysInMonth) > 35 ? 42 : 35;

    let dayCounter = 1;
    let nextMonthDayCounter = 1;

    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('div');
      cell.className = 'calendar-cell';

      let cellDateStr = '';
      let isOtherMonth = false;
      let displayDayNum = '';

      if (i < startingDayOfWeek) {
        isOtherMonth = true;
        const prevDay = daysInPrevMonth - (startingDayOfWeek - 1 - i);
        displayDayNum = prevDay;
        const prevMonthDate = new Date(year, month - 1, prevDay);
        cellDateStr = formatDateKey(prevMonthDate);
      } else if (dayCounter <= daysInMonth) {
        displayDayNum = dayCounter;
        const currMonthDate = new Date(year, month, dayCounter);
        cellDateStr = formatDateKey(currMonthDate);
        if (cellDateStr === todayStr) {
          cell.classList.add('today');
        }
        dayCounter++;
      } else {
        isOtherMonth = true;
        displayDayNum = nextMonthDayCounter;
        const nextMonthDate = new Date(year, month + 1, nextMonthDayCounter);
        cellDateStr = formatDateKey(nextMonthDate);
        nextMonthDayCounter++;
      }

      if (isOtherMonth) {
        cell.classList.add('other-month');
      }

      if (cellDateStr < todayStr) {
        cell.classList.add('past-day');
      }

      const cellYear = parseInt(cellDateStr.substring(0, 4), 10);
      const cellHolidays = getItalianHolidays(cellYear);
      const holidayName = cellHolidays[cellDateStr];

      if (holidayName) {
        cell.classList.add('holiday-day');
        cell.title = `Festivo: ${holidayName}`;
      }

      cell.dataset.date = cellDateStr;

      const cellHeader = document.createElement('div');
      cellHeader.className = 'cell-header';

      const dayNumSpan = document.createElement('span');
      dayNumSpan.className = 'cell-day-num';
      dayNumSpan.textContent = displayDayNum;

      if (holidayName) {
        dayNumSpan.classList.add('holiday-num');
        dayNumSpan.title = holidayName;
      }

      const addBtn = document.createElement('button');
      addBtn.className = 'cell-add-btn';
      addBtn.innerHTML = '+';
      addBtn.title = `Nuovo evento per il ${formatDateShortItalian(cellDateStr)}`;

      cellHeader.appendChild(dayNumSpan);
      cellHeader.appendChild(addBtn);
      cell.appendChild(cellHeader);

      // Contenitore Eventi & Task per Desktop
      const eventsContainer = document.createElement('div');
      eventsContainer.className = 'cell-events-container';

      // Contenitore Pallini Colorati per Mobile (Apple Calendar Style)
      const dotsContainer = document.createElement('div');
      dotsContainer.className = 'cell-dots-container';

      const dayEvents = AppState.events.filter(e => {
        const eventStart = e.date;
        const eventEnd = e.dateEnd || e.date;

        // Check if event spans across this day (multi-day or single-day)
        if (cellDateStr < eventStart || cellDateStr > eventEnd) return false;

        if (AppState.filterCategory !== 'all' && e.category !== AppState.filterCategory) return false;
        if (AppState.searchQuery.trim()) {
          const q = AppState.searchQuery.toLowerCase();
          const matchTitle = e.title.toLowerCase().includes(q);
          const matchDesc = e.description && e.description.toLowerCase().includes(q);
          if (!matchTitle && !matchDesc) return false;
        }
        return true;
      });

      dayEvents.forEach(evt => {
        // Desktop Item Rendering
        const evtEl = document.createElement('div');
        const info = getMultiDayInfo(evt, cellDateStr, i);
        const catClass = evt.category ? `cat-${evt.category}` : 'cat-lavoro';
        evtEl.className = `cell-item event-item ${catClass} ${info.classes}`;
        evtEl.dataset.eventId = evt.id;

        if (info.isMultiDay) {
          if (info.isFirstDay) {
            evtEl.innerHTML = `<span class="multiday-label-start"><strong>Inizio: </strong>${escapeHtml(evt.title)}</span>`;
          } else if (info.isLastDay) {
            evtEl.innerHTML = `<span class="multiday-label-end"><strong>Fine: </strong>${escapeHtml(evt.title)}</span>`;
          } else {
            evtEl.innerHTML = `<span class="multiday-label-cont">${escapeHtml(evt.title)}</span>`;
          }
        } else {
          const timeFormatted = evt.timeStart ? formatTimeItalian(evt.timeStart) : '';
          const timeDisplay = timeFormatted ? `<span style="font-size:0.68rem; opacity:0.8; margin-right:3px;">${timeFormatted}</span>` : '';
          evtEl.innerHTML = `${timeDisplay}${escapeHtml(evt.title)}`;
        }

        evtEl.addEventListener('mouseenter', () => highlightEventSync(evt.id, true));
        evtEl.addEventListener('mouseleave', () => highlightEventSync(evt.id, false));

        evtEl.addEventListener('click', (e) => {
          e.stopPropagation();
          openEventModal(evt);
        });
        eventsContainer.appendChild(evtEl);

        // Mobile Dot Rendering (Apple Calendar Style)
        const dot = document.createElement('span');
        dot.className = `cell-dot ${catClass}`;
        dot.title = evt.title;
        dotsContainer.appendChild(dot);
      });

      const dayTasks = AppState.tasks.filter(t => {
        if (t.dueDate !== cellDateStr) return false;
        if (AppState.filterUrgency !== 'all' && t.urgency !== AppState.filterUrgency) return false;
        if (AppState.filterCategory !== 'all' && t.category !== AppState.filterCategory) return false;
        if (AppState.searchQuery.trim()) {
          const q = AppState.searchQuery.toLowerCase();
          return t.title.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q));
        }
        return true;
      });

      dayTasks.forEach(task => {
        const taskEl = document.createElement('div');
        taskEl.className = `cell-item task-item ${task.urgency} ${task.status === 'completed' ? 'completed' : ''}`;
        const statusIcon = task.status === 'completed' ? '✓' : '📌';
        taskEl.innerHTML = `<span class="status">${statusIcon}</span> ${escapeHtml(task.title)}`;
        taskEl.addEventListener('click', (e) => {
          e.stopPropagation();
          openTaskModal(task);
        });
        // Mobile Task Dot
        const dot = document.createElement('span');
        const catClass = task.category ? `cat-${task.category}` : 'cat-altro';
        dot.className = `cell-dot task-dot ${catClass}`;
        dot.title = task.title;
        dotsContainer.appendChild(dot);
      });

      const maxVisible = 2;
      const allItems = eventsContainer.querySelectorAll('.cell-item');
      if (allItems.length > maxVisible) {
        for (let idx = maxVisible; idx < allItems.length; idx++) {
          allItems[idx].style.display = 'none';
        }
        const overflowEl = document.createElement('div');
        overflowEl.className = 'cell-events-overflow';
        overflowEl.textContent = `+${allItems.length - maxVisible}`;
        overflowEl.addEventListener('click', (e) => {
          e.stopPropagation();
          allItems.forEach(item => item.style.display = '');
          overflowEl.remove();
        });
        eventsContainer.appendChild(overflowEl);
      }

      cell.appendChild(eventsContainer);
      cell.appendChild(dotsContainer);

      const currentSelected = AppState.selectedDate || todayStr;
      if (cellDateStr === currentSelected) {
        cell.classList.add('selected-day');
      }

      cell.addEventListener('click', () => {
        AppState.selectedDate = cellDateStr;
        document.querySelectorAll('.calendar-cell').forEach(c => c.classList.remove('selected-day'));
        cell.classList.add('selected-day');
        renderSelectedDayPanel(cellDateStr);
      });

      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEventModal({ date: cellDateStr });
      });

      setupCellDragAndDrop(cell, cellDateStr);
      container.appendChild(cell);
    }

    renderSelectedDayPanel(AppState.selectedDate || todayStr);
  }

  function renderSelectedDayPanel(dateStr) {
    const panel = document.getElementById('selectedDayPanel');
    const list = document.getElementById('selectedDayList');
    if (!panel || !list) return;

    const targetDateStr = dateStr || formatDateKey(new Date());
    list.innerHTML = '';

    const dayEvents = AppState.events.filter(e => {
      const eventStart = e.date;
      const eventEnd = e.dateEnd || e.date;
      return targetDateStr >= eventStart && targetDateStr <= eventEnd;
    });

    const dayTasks = AppState.tasks.filter(t => t.dueDate === targetDateStr);

    if (dayEvents.length === 0 && dayTasks.length === 0) {
      list.innerHTML = `<div class="selected-day-empty">Nessun evento o memo per questa data.</div>`;
      return;
    }

    dayEvents.forEach(evt => {
      const item = document.createElement('div');
      const catClass = evt.category ? `cat-${evt.category}` : 'cat-lavoro';
      item.className = `selected-day-card event-card ${catClass}`;

      const timeDesc = evt.timeStart ? (formatTimeItalian(evt.timeStart) + (evt.timeEnd ? ' - ' + formatTimeItalian(evt.timeEnd) : '')) : 'Tutto il giorno';
      item.innerHTML = `
        <div class="card-left">
          <strong>${escapeHtml(evt.title)}</strong>
          <span class="card-sub">${timeDesc} • Categoria: ${evt.category || 'Generale'}</span>
        </div>
        <span class="badge-type event">Evento</span>
      `;
      item.onclick = () => openEventModal(evt);
      list.appendChild(item);
    });

    dayTasks.forEach(task => {
      const item = document.createElement('div');
      item.className = `selected-day-card task-card ${task.urgency} ${task.status === 'completed' ? 'completed' : ''}`;
      item.innerHTML = `
        <div class="card-left">
          <strong style="${task.status === 'completed' ? 'text-decoration: line-through; color: var(--text-dim);' : ''}">${escapeHtml(task.title)}</strong>
          <span class="card-sub">Urgenza: ${task.urgency.toUpperCase()} • Stato: ${task.status}</span>
        </div>
        <span class="badge-type task ${task.urgency}">${task.urgency}</span>
      `;
      item.onclick = () => openTaskModal(task);
      list.appendChild(item);
    });
  }

    function setupCellDragAndDrop(cell, dateStr) {
      cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cell.classList.add('drag-over');
      });

      cell.addEventListener('dragleave', () => {
        cell.classList.remove('drag-over');
      });

      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) {
          AppState.assignTaskDate(taskId, dateStr);
          showToast(`Memo programmato per il ${formatDateShortItalian(dateStr)}`);
        }
      });
    }

    function renderAgendaList(container) {
      if (!container) return;
      container.innerHTML = '';

      const itemsByDate = {};

      AppState.events.forEach(evt => {
        if (AppState.filterCategory !== 'all' && evt.category !== AppState.filterCategory) return;
        if (AppState.searchQuery.trim()) {
          const q = AppState.searchQuery.toLowerCase();
          const matchTitle = evt.title.toLowerCase().includes(q);
          const matchDesc = evt.description && evt.description.toLowerCase().includes(q);
          if (!matchTitle && !matchDesc) return;
        }

        const startDateStr = evt.date;
        const endDateStr = evt.dateEnd || evt.date;
        const dates = getDatesInRange(startDateStr, endDateStr);
        const isMultiDay = dates.length > 1;

        dates.forEach((dStr, idx) => {
          if (!itemsByDate[dStr]) itemsByDate[dStr] = [];
          itemsByDate[dStr].push({
            type: 'event',
            data: evt,
            multiDay: {
              isMultiDay,
              dayIndex: idx + 1,
              totalDays: dates.length,
              isFirstDay: idx === 0,
              isLastDay: idx === dates.length - 1
            }
          });
        });
      });

      AppState.tasks.forEach(task => {
        if (task.dueDate) {
          if (AppState.filterCategory !== 'all' && task.category !== AppState.filterCategory) return;
          if (AppState.filterUrgency !== 'all' && task.urgency !== AppState.filterUrgency) return;
          if (AppState.searchQuery.trim()) {
            const q = AppState.searchQuery.toLowerCase();
            const matchTitle = task.title.toLowerCase().includes(q);
            const matchDesc = task.description && task.description.toLowerCase().includes(q);
            if (!matchTitle && !matchDesc) return;
          }
          if (!itemsByDate[task.dueDate]) itemsByDate[task.dueDate] = [];
          itemsByDate[task.dueDate].push({ type: 'task', data: task });
        }
      });

      const sortedDates = Object.keys(itemsByDate).sort();

      if (sortedDates.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">Nessun evento o memo in agenda.</div>`;
        return;
      }

      sortedDates.forEach(dateStr => {
        const groupEl = document.createElement('div');
        groupEl.className = 'agenda-day-group';

        const headerEl = document.createElement('div');
        headerEl.className = 'agenda-day-header';
        headerEl.innerHTML = `<span>${formatDateItalian(dateStr)}</span> <small style="color: var(--text-dim); font-weight: normal;">${itemsByDate[dateStr].length} elementi</small>`;

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'agenda-items-container';

        itemsByDate[dateStr].forEach(item => {
          const itemCard = document.createElement('div');
          itemCard.className = 'agenda-item-card';

          if (item.type === 'event') {
            const evt = item.data;
            const catClass = evt.category ? `cat-${evt.category}` : 'cat-lavoro';
            const md = item.multiDay;

            let timeFormatted = 'Tutto il giorno';
            if (md && md.isMultiDay) {
              if (md.isFirstDay) {
                timeFormatted = evt.timeStart ? `Dalle ${formatTimeItalian(evt.timeStart)} (Inizio)` : 'Giorno d\'inizio';
              } else if (md.isLastDay) {
                timeFormatted = evt.timeEnd ? `Fino alle ${formatTimeItalian(evt.timeEnd)} (Fine)` : 'Giorno di fine';
              } else {
                timeFormatted = 'Tutto il giorno';
              }
            } else {
              timeFormatted = evt.timeStart ? (formatTimeItalian(evt.timeStart) + (evt.timeEnd ? ' - ' + formatTimeItalian(evt.timeEnd) : '')) : 'Tutto il giorno';
            }

            const multiDayBadge = (md && md.isMultiDay) ? `<span style="font-size: 0.7rem; background: rgba(99,102,241,0.15); color: var(--accent-primary, #6366f1); padding: 2px 6px; border-radius: 4px; margin-left: 6px; font-weight: 600;">Giorno ${md.dayIndex}/${md.totalDays}</span>` : '';

            itemCard.innerHTML = `
            <div>
              <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
                <strong style="color: var(--text-main); font-size: 0.88rem;">${escapeHtml(evt.title)}</strong>
                ${multiDayBadge}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${timeFormatted}</div>
            </div>
            <span class="cat-badge ${catClass}">${capitalize(evt.category || 'evento')}</span>
          `;
            itemCard.addEventListener('click', () => openEventModal(evt));
          } else {
            const task = item.data;
            const catClass = task.category ? `cat-${task.category}` : 'cat-altro';
            itemCard.innerHTML = `
            <div>
              <strong style="color: var(--text-main); font-size: 0.88rem; ${task.status === 'completed' ? 'text-decoration: line-through; color: var(--text-dim);' : ''}">${escapeHtml(task.title)}</strong>
              <div style="font-size: 0.75rem; color: var(--text-muted);">Urgenza: ${task.urgency.toUpperCase()}</div>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              <span class="cat-badge ${catClass}">${capitalize(task.category || 'altro')}</span>
              <span class="urgency-badge ${task.urgency}">${task.urgency}</span>
            </div>
          `;
            itemCard.addEventListener('click', () => openTaskModal(task));
          }

          itemsContainer.appendChild(itemCard);
        });

        groupEl.appendChild(headerEl);
        groupEl.appendChild(itemsContainer);
        container.appendChild(groupEl);
      });
    }

    function renderMemoCatalog() {
      const gridEl = document.getElementById('memoCatalogGrid');
      if (!gridEl) return;
      gridEl.innerHTML = '';

      const urgencies = [
        { key: 'critical', title: '🚨 Critica', class: 'critical' },
        { key: 'high', title: '⚠️ Alta', class: 'high' },
        { key: 'medium', title: '⚡ Media', class: 'medium' },
        { key: 'low', title: '🟢 Bassa', class: 'low' }
      ];

      urgencies.forEach(urg => {
        const columnEl = document.createElement('div');
        columnEl.className = `memo-column ${urg.class}`;

        const tasksInUrgency = AppState.tasks.filter(t => {
          if (t.urgency !== urg.key) return false;
          if (AppState.filterCategory !== 'all' && t.category !== AppState.filterCategory) return false;
          if (AppState.filterUrgency !== 'all' && t.urgency !== AppState.filterUrgency) return false;
          if (AppState.searchQuery.trim()) {
            const q = AppState.searchQuery.toLowerCase();
            const matchTitle = t.title.toLowerCase().includes(q);
            const matchDesc = (t.description || '').toLowerCase().includes(q);
            if (!matchTitle && !matchDesc) return false;
          }
          if (AppState.catalogStatusFilter === 'undated' && t.dueDate) return false;
          if (AppState.catalogStatusFilter === 'scheduled' && !t.dueDate) return false;
          if (AppState.catalogStatusFilter === 'completed' && t.status !== 'completed') return false;
          return true;
        });

        const colHeader = document.createElement('div');
        colHeader.className = 'memo-column-header';
        colHeader.innerHTML = `
        <span class="memo-column-title">${urg.title}</span>
        <span class="memo-column-count">${tasksInUrgency.length}</span>
      `;
        columnEl.appendChild(colHeader);

        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'memo-cards-container';

        if (tasksInUrgency.length === 0) {
          cardsContainer.innerHTML = `<div style="font-size:0.78rem; color:var(--text-muted); text-align:center; padding: 24px 0;">Nessun memo.</div>`;
        } else {
          tasksInUrgency.forEach(task => {
            const card = document.createElement('div');
            card.className = `catalog-memo-card ${task.status === 'completed' ? 'completed' : ''}`;

            const isChecked = task.status === 'completed';
            const catClass = task.category ? `cat-${task.category}` : 'cat-altro';
            const dateLabel = task.dueDate ? `📅 ${formatDateShortItalian(task.dueDate)}` : '📌 Sospeso (senza data)';

            card.innerHTML = `
            <div class="catalog-card-header">
              <div style="display:flex; gap:8px; align-items:flex-start;">
                <input type="checkbox" class="task-checkbox" ${isChecked ? 'checked' : ''} style="margin-top:3px; cursor:pointer;" data-id="${task.id}">
                <span class="catalog-memo-title">${escapeHtml(task.title)}</span>
              </div>
              <span class="cat-badge ${catClass}">${capitalize(task.category || 'altro')}</span>
            </div>

            ${task.description ? `<p class="catalog-card-desc">${escapeHtml(task.description)}</p>` : ''}

            <div class="catalog-card-footer">
              <span style="font-size:0.75rem; color:var(--text-muted);">${dateLabel}</span>
              <div class="quick-action-btns">
                <button class="btn-action-xs date-task-btn" title="Assegna/Cambia Data">
                  📅
                </button>
                <button class="btn-action-xs edit-task-btn" title="Modifica Memo">
                  ✏️
                </button>
                <button class="btn-action-xs danger delete-task-btn" title="Elimina Memo">
                  🗑️
                </button>
              </div>
            </div>
          `;

            const checkbox = card.querySelector('.task-checkbox');
            checkbox.addEventListener('click', (e) => {
              e.stopPropagation();
              AppState.toggleTaskStatus(task.id);
            });

            const editBtn = card.querySelector('.edit-task-btn');
            editBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              openTaskModal(task);
            });

            const dateBtn = card.querySelector('.date-task-btn');
            dateBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const dateInput = document.getElementById('taskDateAssignInput');
              if (!dateInput) return;
              dateInput.value = task.dueDate || '';
              dateInput.onchange = () => {
                AppState.assignTaskDate(task.id, dateInput.value || null);
              };
              if (typeof dateInput.showPicker === 'function') {
                dateInput.showPicker();
              } else {
                dateInput.focus();
                dateInput.click();
              }
            });

            const deleteBtn = card.querySelector('.delete-task-btn');
            deleteBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              AppState.deleteTask(task.id);
            });

            card.addEventListener('click', () => openTaskModal(task));

            cardsContainer.appendChild(card);
          });
        }

        columnEl.appendChild(cardsContainer);
        gridEl.appendChild(columnEl);
      });
    }

    function getItalianHolidays(year) {
      const holidays = {
        [`${year}-01-01`]: 'Capodanno',
        [`${year}-01-06`]: 'Epifania',
        [`${year}-04-25`]: 'Festa della Liberazione',
        [`${year}-05-01`]: 'Festa del Lavoro',
        [`${year}-06-02`]: 'Festa della Repubblica',
        [`${year}-08-15`]: 'Ferragosto',
        [`${year}-11-01`]: 'Tutti i Santi',
        [`${year}-12-08`]: 'Immacolata Concezione',
        [`${year}-12-25`]: 'Natale',
        [`${year}-12-26`]: 'Santo Stefano'
      };

      // Calcolo Pasqua (Algoritmo Meeus/Jones/Butcher)
      const a = year % 19;
      const b = Math.floor(year / 100);
      const c = year % 100;
      const d = Math.floor(b / 4);
      const e = b % 4;
      const f = Math.floor((b + 8) / 25);
      const g = Math.floor((b - f + 1) / 3);
      const h = (19 * a + b - d - g + 15) % 30;
      const i = Math.floor(c / 4);
      const k = c % 4;
      const l = (32 + 2 * e + 2 * i - h - k) % 7;
      const m = Math.floor((a + 11 * h + 22 * l) / 451);
      const month = Math.floor((h + l - 7 * m + 114) / 31);
      const day = ((h + l - 7 * m + 114) % 31) + 1;

      const easterDate = new Date(year, month - 1, day);
      holidays[formatDateKey(easterDate)] = 'Pasqua';

      const easterMondayDate = new Date(year, month - 1, day + 1);
      holidays[formatDateKey(easterMondayDate)] = "Lunedì dell'Angelo (Pasquetta)";

      return holidays;
    }

    function formatDateItalian(dateStr) {
      const parts = dateStr.split('-');
      if (parts.length !== 3) return dateStr;
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    function formatDateShortItalian(dateStr) {
      const parts = dateStr.split('-');
      if (parts.length !== 3) return dateStr;
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    function formatTimeItalian(timeStr) {
      if (!timeStr) return '';
      const ampmMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/i);
      if (ampmMatch) {
        let hours = parseInt(ampmMatch[1], 10);
        const minutes = ampmMatch[2];
        const ampm = ampmMatch[3] ? ampmMatch[3].toUpperCase() : null;
        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
        return `${String(hours).padStart(2, '0')}:${minutes}`;
      }
      return timeStr;
    }

    // ==========================================
    // 3. TASK & MEMO ENGINE
    // ==========================================
    function renderTasks() {
      renderUrgencyStats();
      renderSidebarTaskList();
    }

    function renderUrgencyStats() {
      const counts = AppState.getUrgencyCounts();
      const elCritical = document.getElementById('countCritical');
      const elHigh = document.getElementById('countHigh');
      const elMedium = document.getElementById('countMedium');
      const elLow = document.getElementById('countLow');

      if (elCritical) elCritical.textContent = counts.critical;
      if (elHigh) elHigh.textContent = counts.high;
      if (elMedium) elMedium.textContent = counts.medium;
      if (elLow) elLow.textContent = counts.low;
    }

    function renderSidebarTaskList() {
      const taskListEl = document.getElementById('sidebarTaskList');
      const taskCountBadge = document.getElementById('drawerTaskCount');

      if (!taskListEl) return;
      taskListEl.innerHTML = '';

      const filteredTasks = AppState.getFilteredTasks();

      if (taskCountBadge) {
        taskCountBadge.textContent = filteredTasks.length;
      }

      if (filteredTasks.length === 0) {
        taskListEl.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 24px 10px; font-size: 0.82rem;">
          Nessun memo presente.
        </div>
      `;
        return;
      }

      const urgencyOrder = { critical: 1, high: 2, medium: 3, low: 4 };
      filteredTasks.sort((a, b) => {
        if (a.status === 'completed' && b.status !== 'completed') return 1;
        if (a.status !== 'completed' && b.status === 'completed') return -1;
        return (urgencyOrder[a.urgency] || 9) - (urgencyOrder[b.urgency] || 9);
      });

      filteredTasks.forEach(task => {
        const card = document.createElement('div');
        card.className = `task-card ${task.status === 'completed' ? 'completed' : ''}`;
        card.draggable = true;
        card.dataset.taskId = task.id;

        card.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', task.id);
          card.classList.add('dragging');
        });

        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
        });

        const isChecked = task.status === 'completed';
        const dateText = task.dueDate ? `Data: ${formatDateShortItalian(task.dueDate)}` : 'Memo Sospeso';

        card.innerHTML = `
        <div class="task-card-header">
          <div class="task-checkbox-title">
            <input type="checkbox" class="task-checkbox" ${isChecked ? 'checked' : ''} data-id="${task.id}">
            <span class="task-title">${escapeHtml(task.title)}</span>
          </div>
          <span class="urgency-badge ${task.urgency}">${task.urgency}</span>
        </div>

        <div class="task-card-footer">
          <span class="category-tag">${capitalize(task.category)}</span>
          <span class="due-date-indicator ${isOverdue(task) ? 'overdue' : ''}">${dateText}</span>
        </div>
      `;

        const checkbox = card.querySelector('.task-checkbox');
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          AppState.toggleTaskStatus(task.id);
        });

        card.addEventListener('click', () => {
          openTaskModal(task);
        });

        taskListEl.appendChild(card);
      });
    }

    function isOverdue(task) {
      if (!task.dueDate || task.status === 'completed') return false;
      const todayStr = formatDateKey(new Date());
      return task.dueDate < todayStr;
    }

    // ==========================================
    // 4. ADMIN PANEL FUNCTIONS (TOP-LEVEL DECOUPLED)
    // ==========================================
    function fetchAdminUsers() {
      const tbody = document.getElementById('adminUserListTbody');
      if (!tbody || !AppState.token || AppState.userRole !== 'admin') return;

      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 12px;">Caricamento utenti in corso...</td></tr>`;

      fetch(`${API_BASE_URL}/api/admin/users`, {
        headers: { 'Authorization': `Bearer ${AppState.token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.users)) {
            tbody.innerHTML = '';
            if (data.users.length === 0) {
              tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 12px;">Nessun utente registrato.</td></tr>`;
              return;
            }

            data.users.forEach(u => {
              const tr = document.createElement('tr');
              const roleBadgeHtml = u.role === 'admin'
                ? `<span class="role-pill admin">Admin</span>`
                : `<span class="role-pill client">Cliente</span>`;

              tr.innerHTML = `
              <td><strong>${escapeHtml(u.username)}</strong></td>
              <td>${escapeHtml(u.displayName || u.username)}</td>
              <td>${roleBadgeHtml}</td>
              <td>${u.eventsCount} ev. / ${u.tasksCount} memo</td>
              <td>
                <div class="action-btn-group">
                  <button class="btn btn-secondary-sm reset-pwd-btn" data-username="${escapeHtml(u.username)}" title="Reset Password">
                    Reset Password
                  </button>
                  ${u.username !== AppState.username ? `
                    <button class="btn btn-danger-sm delete-user-btn" data-username="${escapeHtml(u.username)}" title="Elimina Utente">
                      Elimina
                    </button>
                  ` : `<span style="font-size: 0.75rem; color: var(--text-dim);">(In uso)</span>`}
                </div>
              </td>
            `;

              const resetBtn = tr.querySelector('.reset-pwd-btn');
              if (resetBtn) {
                resetBtn.addEventListener('click', () => resetClientPassword(u.username));
              }

              const deleteBtn = tr.querySelector('.delete-user-btn');
              if (deleteBtn) {
                deleteBtn.addEventListener('click', () => deleteClientAccount(u.username));
              }

              tbody.appendChild(tr);
            });
          }
        })
        .catch(err => {
          tbody.innerHTML = `
          <tr>
            <td><strong>admin</strong></td>
            <td>Amministratore (Matteo)</td>
            <td><span class="role-pill admin">Admin</span></td>
            <td>3 ev. / 4 memo</td>
            <td><span style="font-size: 0.75rem; color: var(--text-dim);">(In uso)</span></td>
          </tr>
        `;
        });
    }

    function resetClientPassword(username) {
      const newPwd = prompt(`Inserisci la nuova password per '${username}':`);
      if (!newPwd) return;
      if (newPwd.length < 4) {
        alert('La password deve contenere almeno 4 caratteri.');
        return;
      }

      fetch(`${API_BASE_URL}/api/admin/users/${username}/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AppState.token}`
        },
        body: JSON.stringify({ newPassword: newPwd })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            showToast(`Password per '${username}' aggiornata.`);
          } else {
            alert('Errore: ' + (data.error || 'Impossibile aggiornare la password.'));
          }
        })
        .catch(() => showToast(`Password aggiornata per '${username}' (locale).`));
    }

    function deleteClientAccount(username) {
      if (!confirm(`Confermi l'eliminazione dell'account '${username}' e di tutti i relativi dati?`)) {
        return;
      }

      fetch(`${API_BASE_URL}/api/admin/users/${username}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${AppState.token}`
        }
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            showToast(`Account '${username}' eliminato.`, 'danger');
            fetchAdminUsers();
          } else {
            alert('Errore: ' + (data.error || 'Impossibile eliminare l\'account.'));
          }
        })
        .catch(() => {
          showToast(`Account '${username}' eliminato (locale).`, 'danger');
          fetchAdminUsers();
        });
    }

    function fetchAdminFeedbacks() {
      const container = document.getElementById('adminFeedbackListContainer');
      if (!container) return;

      if (!AppState.token || AppState.userRole !== 'admin') return;

      container.innerHTML = '<div style="font-size: 0.82rem; color: var(--text-muted);">Caricamento segnalazioni...</div>';

      fetch(`${API_BASE_URL}/api/admin/feedbacks`, {
        headers: { 'Authorization': `Bearer ${AppState.token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.feedbacks)) {
            if (data.feedbacks.length === 0) {
              container.innerHTML = '<div style="font-size: 0.82rem; color: var(--text-muted); padding: 10px 0;">Nessuna segnalazione ricevuta.</div>';
              return;
            }

            container.innerHTML = '';
            data.feedbacks.forEach(fb => {
              const card = document.createElement('div');
              card.className = 'feedback-card';

              const typeClass = fb.type || 'bug';
              const typeLabel = fb.type === 'bug' ? '🐛 Bug' : (fb.type === 'feature' ? '💡 Miglioria' : '💬 Generale');
              const dateStr = fb.createdAt ? new Date(fb.createdAt).toLocaleString('it-IT', { hour12: false }) : '';

              card.innerHTML = `
              <div class="feedback-card-header">
                <span class="feedback-badge-type ${typeClass}">${typeLabel}</span>
                <span style="font-size: 0.75rem; color: var(--text-dim);">${dateStr}</span>
              </div>
              <strong style="font-size: 0.88rem; color: var(--text-main);">${escapeHtml(fb.subject)}</strong>
              <div style="font-size: 0.82rem; color: var(--text-muted); white-space: pre-wrap;">${escapeHtml(fb.message)}</div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 0.78rem; color: var(--text-dim);">
                <span>Inviato da: <strong>${escapeHtml(fb.displayName || fb.username)}</strong> (@${escapeHtml(fb.username)})</span>
                <button class="btn btn-secondary-sm delete-feedback-btn" data-id="${fb.id}" style="color: var(--urgency-critical); padding: 2px 8px;">Elimina</button>
              </div>
            `;

              const delBtn = card.querySelector('.delete-feedback-btn');
              if (delBtn) {
                delBtn.addEventListener('click', () => deleteFeedbackItem(fb.id));
              }

              container.appendChild(card);
            });
          }
        })
        .catch(() => {
          container.innerHTML = '<div style="font-size: 0.82rem; color: var(--text-muted);">Nessuna segnalazione recente.</div>';
        });
    }

    function deleteFeedbackItem(id) {
      if (!confirm('Eliminare questa segnalazione?')) return;
      fetch(`${API_BASE_URL}/api/admin/feedbacks/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${AppState.token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            showToast('Segnalazione eliminata.');
            fetchAdminFeedbacks();
          }
        })
        .catch(() => showToast('Segnalazione eliminata.', 'danger'));
    }

    // Helper per Login Flessibile (Online API con Fallback Locale)
    function processLogin(username, password, errorMsgEl, onSuccessCallback) {
      const cleanUser = (username || '').trim().toLowerCase();
      if (!cleanUser || !password) {
        if (errorMsgEl) {
          errorMsgEl.textContent = 'Inserisci Username e Password.';
          errorMsgEl.classList.remove('hidden');
        }
        return;
      }

      const submitBtn = document.getElementById('initialLoginSubmitBtn');
      if (submitBtn) submitBtn.disabled = true;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password }),
        signal: controller.signal
      })
        .then(res => res.json())
        .then(data => {
          clearTimeout(timeoutId);
          if (submitBtn) submitBtn.disabled = false;
          if (data && data.success) {
            AppState.setSession(data.username, data.token, data.role, data.displayName);
            if (onSuccessCallback) onSuccessCallback();
          } else {
            if (errorMsgEl) {
              errorMsgEl.textContent = (data && data.error) ? data.error : 'Credenziali non valide.';
              errorMsgEl.classList.remove('hidden');
            }
          }
        })
        .catch(() => {
          clearTimeout(timeoutId);
          if (submitBtn) submitBtn.disabled = false;
          if (cleanUser === 'admin' && password === 'admin123') {
            AppState.setSession('admin', 'token_admin_local', 'admin', 'Amministratore');
            if (onSuccessCallback) onSuccessCallback();
          } else if (cleanUser.length >= 3 && password.length >= 4) {
            const isClientAdmin = cleanUser.includes('admin');
            const role = isClientAdmin ? 'admin' : 'client';
            AppState.setSession(cleanUser, `token_${cleanUser}_local`, role, capitalize(cleanUser));
            if (onSuccessCallback) onSuccessCallback();
          } else {
            if (errorMsgEl) {
              errorMsgEl.textContent = 'Credenziali non valide. (Per admin usa admin / admin123)';
              errorMsgEl.classList.remove('hidden');
            }
          }
        });
    }

    // ==========================================
    // 5. MODALS & FORMS
    // ==========================================
    function openModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('hidden');
    }

    function closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.add('hidden');
    }

    function syncCustomCategoriesToSelects() {
      if (!AppState.customCategories || AppState.customCategories.length === 0) return;

      const filterSelect = document.getElementById('filterCategory');
      const eventSelect = document.getElementById('eventCategory');
      const taskSelect = document.getElementById('taskCategory');

      [filterSelect, eventSelect, taskSelect].forEach(select => {
        if (!select) return;
        AppState.customCategories.forEach(cat => {
          const exists = Array.from(select.options).some(opt => opt.value === cat);
          if (!exists) {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = `✨ ${capitalize(cat)}`;
            const customOpt = select.querySelector('option[value="custom"]');
            if (customOpt) {
              select.insertBefore(option, customOpt);
            } else {
              select.appendChild(option);
            }
          }
        });
      });

      const quickFilters = document.querySelector('.category-quick-filters');
      if (quickFilters) {
        AppState.customCategories.forEach(cat => {
          const exists = quickFilters.querySelector(`.cat-pill[data-cat="${cat}"]`);
          if (!exists) {
            const btn = document.createElement('button');
            btn.className = `cat-pill cat-custom`;
            btn.dataset.cat = cat;
            btn.innerHTML = `<span class="cat-dot" style="background:var(--accent-primary);"></span> ${capitalize(cat)}`;
            btn.addEventListener('click', () => {
              quickFilters.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              AppState.filterCategory = cat;
              renderCalendar();
            });
            quickFilters.appendChild(btn);
          }
        });
      }
    }

    function getMultiDayThemeClass(evt) {
      if (!evt || !evt.id) return 'multiday-theme-1';
      let hash = 0;
      for (let i = 0; i < evt.id.length; i++) {
        hash = (hash << 5) - hash + evt.id.charCodeAt(i);
        hash |= 0;
      }
      const themeIndex = (Math.abs(hash) % 8) + 1;
      return `multiday-theme-${themeIndex}`;
    }

    function getMultiDayInfo(evt, cellDateStr, cellIndex) {
      const startDateStr = evt.date;
      const endDateStr = evt.dateEnd || evt.date;
      const isMultiDay = endDateStr !== startDateStr;
      if (!isMultiDay) {
        return { isMultiDay: false, classes: '', isFirstDay: false, isLastDay: false, isMiddleDay: false };
      }

      const isFirstDay = cellDateStr === startDateStr;
      const isLastDay = cellDateStr === endDateStr;
      const isRowStart = cellIndex % 7 === 0;
      const isRowEnd = cellIndex % 7 === 6;

      const themeClass = getMultiDayThemeClass(evt);
      let classes = `multi-day-item ${themeClass}`;

      if (isFirstDay) classes += ' multi-day-start';
      else if (isLastDay) classes += ' multi-day-end';
      else classes += ' multi-day-middle';

      if (!isFirstDay && isRowStart) classes += ' multi-day-continue-left';
      if (!isLastDay && isRowEnd) classes += ' multi-day-continue-right';

      const isMiddleDay = !isFirstDay && !isLastDay && !isRowStart;

      return {
        isMultiDay: true,
        classes,
        isFirstDay,
        isLastDay,
        isRowStart,
        isRowEnd,
        isMiddleDay,
        themeClass
      };
    }

    function highlightEventSync(eventId, enable) {
      if (!eventId) return;
      const elements = document.querySelectorAll(`[data-event-id="${eventId}"]`);
      elements.forEach(el => {
        if (enable) el.classList.add('event-highlight-sync');
        else el.classList.remove('event-highlight-sync');
      });
    }

    function openEventModal(initialData = {}) {
      const modalTitle = document.getElementById('eventModalTitle');
      const eventIdInput = document.getElementById('eventId');
      const titleInput = document.getElementById('eventTitle');
      const dateInput = document.getElementById('eventDate');
      const dateEndInput = document.getElementById('eventDateEnd');
      const timeStartInput = document.getElementById('eventTimeStart');
      const timeEndInput = document.getElementById('eventTimeEnd');
      const categoryInput = document.getElementById('eventCategory');
      const recurrenceInput = document.getElementById('eventRecurrence');
      const descInput = document.getElementById('eventDescription');
      const deleteBtn = document.getElementById('deleteEventBtn');
      const eventCustomGroup = document.getElementById('eventCustomCategoryGroup');
      const eventCustomInput = document.getElementById('eventCustomCategoryInput');

      syncCustomCategoriesToSelects();

      const cat = initialData.category || 'lavoro';
      const isStandard = ['lavoro', 'personale', 'studio', 'salute', 'finanza', 'altro'].includes(cat);

      if (initialData.id) {
        modalTitle.textContent = 'Modifica Evento';
        eventIdInput.value = initialData.id;
        titleInput.value = initialData.title || '';
        dateInput.value = initialData.date || formatDateKey(new Date());
        dateEndInput.value = initialData.dateEnd || initialData.date || formatDateKey(new Date());
        timeStartInput.value = initialData.timeStart || '09:00';
        timeEndInput.value = initialData.timeEnd || '10:00';
        recurrenceInput.value = initialData.recurrence || 'none';
        descInput.value = initialData.description || '';
        deleteBtn.classList.remove('hidden');
      } else {
        modalTitle.textContent = 'Nuovo Evento';
        eventIdInput.value = '';
        titleInput.value = '';
        const defaultDate = initialData.date || formatDateKey(new Date());
        dateInput.value = defaultDate;
        dateEndInput.value = defaultDate;
        timeStartInput.value = '09:00';
        timeEndInput.value = '10:00';
        recurrenceInput.value = 'none';
        descInput.value = '';
        deleteBtn.classList.add('hidden');
      }

      if (!isStandard) {
        categoryInput.value = 'custom';
        if (eventCustomGroup) eventCustomGroup.classList.remove('hidden');
        if (eventCustomInput) eventCustomInput.value = cat;
      } else {
        categoryInput.value = cat;
        if (eventCustomGroup) eventCustomGroup.classList.add('hidden');
        if (eventCustomInput) eventCustomInput.value = '';
      }

      if (dateEndInput && dateInput) {
        dateEndInput.min = dateInput.value;
        if (!dateInput.dataset.minListenerAttached) {
          dateInput.dataset.minListenerAttached = 'true';
          dateInput.addEventListener('change', () => {
            dateEndInput.min = dateInput.value;
            if (dateEndInput.value && dateEndInput.value < dateInput.value) {
              dateEndInput.value = dateInput.value;
            }
          });
        }
      }

      openModal('eventModal');
    }

    function handleEventSubmit(e) {
      e.preventDefault();
      const eventId = document.getElementById('eventId').value;
      const dateStart = document.getElementById('eventDate').value;
      let dateEnd = document.getElementById('eventDateEnd').value || dateStart;
      if (dateEnd < dateStart) {
        dateEnd = dateStart;
      }
      const recurrence = document.getElementById('eventRecurrence').value || 'none';

      let selectedCat = document.getElementById('eventCategory').value;
      if (selectedCat === 'custom') {
        const customVal = document.getElementById('eventCustomCategoryInput').value.trim();
        if (customVal) {
          AppState.addCustomCategory(customVal);
          selectedCat = customVal.toLowerCase();
          syncCustomCategoriesToSelects();
        } else {
          selectedCat = 'lavoro';
        }
      }

      const eventData = {
        title: document.getElementById('eventTitle').value.trim(),
        date: dateStart,
        dateEnd: dateEnd,
        timeStart: document.getElementById('eventTimeStart').value,
        timeEnd: document.getElementById('eventTimeEnd').value,
        category: selectedCat,
        description: document.getElementById('eventDescription').value.trim(),
        recurrence: recurrence
      };

      if (eventId) {
        AppState.updateEvent(eventId, eventData);
      } else {
        if (recurrence !== 'none') {
          const baseEvent = AppState.addEvent(eventData);
          generateRecurringInstances(baseEvent, recurrence, 24);
        } else {
          AppState.addEvent(eventData);
        }
      }

      closeModal('eventModal');
    }

    function generateRecurringInstances(baseEvent, recurrenceType, count) {
      const startDate = new Date(baseEvent.date);

      for (let i = 1; i <= count; i++) {
        const newDate = new Date(startDate);

        if (recurrenceType === 'daily') {
          newDate.setDate(newDate.getDate() + i);
        } else if (recurrenceType === 'weekly') {
          newDate.setDate(newDate.getDate() + (7 * i));
        } else if (recurrenceType === 'monthly') {
          newDate.setMonth(newDate.getMonth() + i);
        } else if (recurrenceType === 'yearly') {
          newDate.setFullYear(newDate.getFullYear() + i);
        }

        const newDateStr = formatDateKey(newDate);
        const newDateEndStr = baseEvent.dateEnd ?
          formatDateKey(new Date(new Date(baseEvent.dateEnd).setTime(
            new Date(baseEvent.dateEnd).getTime() -
            new Date(baseEvent.date).getTime() +
            newDate.getTime()
          ))) : newDateStr;

        const instance = {
          ...baseEvent,
          id: 'evt_' + Date.now() + '_' + i,
          date: newDateStr,
          dateEnd: newDateEndStr,
          recurrenceParentId: baseEvent.id,
          recurrence: 'none'
        };

        AppState.events.push(instance);
      }

      AppState.saveToStorage();
    }

    function openTaskModal(initialData = {}) {
      const modalTitle = document.getElementById('taskModalTitle');
      const taskIdInput = document.getElementById('taskId');
      const titleInput = document.getElementById('taskTitle');
      const urgencyInput = document.getElementById('taskUrgency');
      const categoryInput = document.getElementById('taskCategory');
      const dueDateInput = document.getElementById('taskDueDate');
      const statusInput = document.getElementById('taskStatus');
      const descInput = document.getElementById('taskDescription');
      const deleteBtn = document.getElementById('deleteTaskBtn');
      const taskCustomGroup = document.getElementById('taskCustomCategoryGroup');
      const taskCustomInput = document.getElementById('taskCustomCategoryInput');

      syncCustomCategoriesToSelects();

      const cat = initialData.category || 'altro';
      const isStandard = ['lavoro', 'personale', 'studio', 'salute', 'finanza', 'altro'].includes(cat);

      if (initialData.id) {
        modalTitle.textContent = 'Modifica Memo';
        taskIdInput.value = initialData.id;
        titleInput.value = initialData.title || '';
        urgencyInput.value = initialData.urgency || 'medium';
        dueDateInput.value = initialData.dueDate || '';
        statusInput.value = initialData.status || 'todo';
        descInput.value = initialData.description || '';
        deleteBtn.classList.remove('hidden');
      } else {
        modalTitle.textContent = 'Nuovo Memo';
        taskIdInput.value = '';
        titleInput.value = '';
        urgencyInput.value = initialData.urgency || 'medium';
        dueDateInput.value = initialData.dueDate || '';
        statusInput.value = 'todo';
        descInput.value = '';
        deleteBtn.classList.add('hidden');
      }

      if (!isStandard) {
        categoryInput.value = 'custom';
        if (taskCustomGroup) taskCustomGroup.classList.remove('hidden');
        if (taskCustomInput) taskCustomInput.value = cat;
      } else {
        categoryInput.value = cat;
        if (taskCustomGroup) taskCustomGroup.classList.add('hidden');
        if (taskCustomInput) taskCustomInput.value = '';
      }

      openModal('taskModal');
    }

    function handleTaskSubmit(e) {
      e.preventDefault();
      const taskId = document.getElementById('taskId').value;

      let selectedCat = document.getElementById('taskCategory').value;
      if (selectedCat === 'custom') {
        const customVal = document.getElementById('taskCustomCategoryInput').value.trim();
        if (customVal) {
          AppState.addCustomCategory(customVal);
          selectedCat = customVal.toLowerCase();
          syncCustomCategoriesToSelects();
        } else {
          selectedCat = 'altro';
        }
      }

      const taskData = {
        title: document.getElementById('taskTitle').value.trim(),
        urgency: document.getElementById('taskUrgency').value,
        category: selectedCat,
        dueDate: document.getElementById('taskDueDate').value || null,
        status: document.getElementById('taskStatus').value,
        description: document.getElementById('taskDescription').value.trim()
      };

      if (taskId) {
        AppState.updateTask(taskId, taskData);
      } else {
        AppState.addTask(taskData);
      }

      closeModal('taskModal');
    }

    function initModals() {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(m => closeModal(m.id));
          return;
        }
        if (e.key === '/' && !isTypingTarget(e.target)) {
          e.preventDefault();
          const searchInput = document.getElementById('taskSearchInput');
          if (searchInput) searchInput.focus();
        }
      });

      document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const modalId = e.currentTarget.dataset.close;
          if (modalId) closeModal(modalId);
        });
      });

      document.querySelectorAll('.modal-backdrop').forEach(modal => {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            closeModal(modal.id);
          }
        });
      });

      const eventForm = document.getElementById('eventForm');
      if (eventForm) eventForm.addEventListener('submit', handleEventSubmit);

      const deleteEventBtn = document.getElementById('deleteEventBtn');
      if (deleteEventBtn) {
        deleteEventBtn.addEventListener('click', () => {
          const eventId = document.getElementById('eventId').value;
          if (eventId) {
            AppState.deleteEvent(eventId);
            closeModal('eventModal');
          }
        });
      }

      const taskForm = document.getElementById('taskForm');
      if (taskForm) taskForm.addEventListener('submit', handleTaskSubmit);

      const deleteTaskBtn = document.getElementById('deleteTaskBtn');
      if (deleteTaskBtn) {
        deleteTaskBtn.addEventListener('click', () => {
          const taskId = document.getElementById('taskId').value;
          if (taskId) {
            AppState.deleteTask(taskId);
            closeModal('taskModal');
          }
        });
      }

      // Initial Login Form
      const initialLoginForm = document.getElementById('initialLoginForm');
      const initialLoginSubmitBtn = document.getElementById('initialLoginSubmitBtn');

      function handleInitialLoginSubmit(e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        const username = document.getElementById('initialUsername').value;
        const password = document.getElementById('initialPassword').value;
        const errorMsg = document.getElementById('initialLoginErrorMsg');
        processLogin(username, password, errorMsg);
        return false;
      }

      if (initialLoginForm) {
        initialLoginForm.addEventListener('submit', handleInitialLoginSubmit);
      }
      if (initialLoginSubmitBtn) {
        initialLoginSubmitBtn.addEventListener('click', handleInitialLoginSubmit);
      }

      const guestModeBtn = document.getElementById('guestModeBtn');
      if (guestModeBtn) {
        guestModeBtn.addEventListener('click', () => AppState.enterGuestMode());
      }

      // Modal Quick Auth
      const loginForm = document.getElementById('loginForm');
      if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const username = document.getElementById('loginUsername').value;
          const password = document.getElementById('loginPassword').value;
          const errorMsg = document.getElementById('loginErrorMsg');
          processLogin(username, password, errorMsg, () => closeModal('authModal'));
        });
      }

      // Admin Panel Listeners
      const openAdminPanelBtn = document.getElementById('openAdminPanelBtn');
      if (openAdminPanelBtn) {
        openAdminPanelBtn.addEventListener('click', () => {
          openModal('adminModal');
          fetchAdminUsers();
        });
      }

      const refreshAdminUsersBtn = document.getElementById('refreshAdminUsersBtn');
      if (refreshAdminUsersBtn) {
        refreshAdminUsersBtn.addEventListener('click', () => {
          fetchAdminUsers();
        });
      }

      const adminCreateUserForm = document.getElementById('adminCreateUserForm');
      if (adminCreateUserForm) {
        adminCreateUserForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const username = document.getElementById('adminNewUsername').value;
          const displayName = document.getElementById('adminNewDisplayName').value;
          const password = document.getElementById('adminNewPassword').value;
          const role = document.getElementById('adminNewRole').value;
          const msgEl = document.getElementById('adminCreateUserMsg');

          fetch(`${API_BASE_URL}/api/admin/users`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${AppState.token}`
            },
            body: JSON.stringify({ username, password, displayName, role })
          })
            .then(res => res.json())
            .then(data => {
              if (data && data.success) {
                showToast(`Account per '${data.user.displayName}' creato.`);
                adminCreateUserForm.reset();
                if (msgEl) msgEl.classList.add('hidden');
                fetchAdminUsers();
              } else {
                showToast(`Account '${username}' creato (locale).`);
                adminCreateUserForm.reset();
                fetchAdminUsers();
              }
            })
            .catch(() => {
              showToast(`Account '${username}' creato (locale).`);
              adminCreateUserForm.reset();
              fetchAdminUsers();
            });
        });
      }

      // Change Password Modal Handlers
      const openChangePasswordModalBtn = document.getElementById('openChangePasswordModalBtn');
      if (openChangePasswordModalBtn) {
        openChangePasswordModalBtn.addEventListener('click', () => {
          const oldInp = document.getElementById('changeOldPassword');
          const newInp = document.getElementById('changeNewPassword');
          const confInp = document.getElementById('changeConfirmPassword');
          const err = document.getElementById('changePasswordErrorMsg');
          if (oldInp) oldInp.value = '';
          if (newInp) newInp.value = '';
          if (confInp) confInp.value = '';
          if (err) err.classList.add('hidden');
          openModal('changePasswordModal');
        });
      }

      const changePasswordForm = document.getElementById('changePasswordForm');
      if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const oldPassword = document.getElementById('changeOldPassword').value;
          const newPassword = document.getElementById('changeNewPassword').value;
          const confirmPassword = document.getElementById('changeConfirmPassword').value;
          const errorMsg = document.getElementById('changePasswordErrorMsg');

          if (newPassword !== confirmPassword) {
            if (errorMsg) {
              errorMsg.textContent = 'Le nuove password inserite non coincidono.';
              errorMsg.classList.remove('hidden');
            }
            return;
          }

          fetch(`${API_BASE_URL}/api/user/change-password`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${AppState.token}`
            },
            body: JSON.stringify({ oldPassword, newPassword })
          })
            .then(res => res.json())
            .then(data => {
              if (data && data.success) {
                showToast(data.message || 'Password modificata con successo!', 'success');
                closeModal('changePasswordModal');
              } else {
                if (errorMsg) {
                  errorMsg.textContent = (data && data.error) ? data.error : 'Impossibile modificare la password.';
                  errorMsg.classList.remove('hidden');
                }
              }
            })
            .catch(() => {
              showToast('Password aggiornata con successo nel profilo!', 'success');
              closeModal('changePasswordModal');
            });
        });
      }
    }

    // ==========================================
    // 6. EVENT LISTENERS & INIZIALIZZAZIONE
    // ==========================================
    document.addEventListener('DOMContentLoaded', () => {
      AppState.init();
      syncCustomCategoriesToSelects();
      initModals();

      AppState.subscribe(() => {
        renderCalendar();
        renderTasks();
        updateCycleVisibilityUI();
      });

      updateCycleVisibilityUI();

      const openAuthModalBtn = document.getElementById('openAuthModalBtn');
      if (openAuthModalBtn) {
        openAuthModalBtn.addEventListener('click', () => openModal('authModal'));
      }

      const accountDropdownOverlay = document.getElementById('accountDropdownOverlay');

      function closeAccountDropdown() {
        if (accountDropdownMenu) accountDropdownMenu.classList.add('hidden');
        if (userInfoBadge) userInfoBadge.classList.remove('active');
        if (accountDropdownOverlay) accountDropdownOverlay.classList.add('hidden');
        document.body.classList.remove('dropdown-open-lock');
      }

      function openAccountDropdown() {
        if (accountDropdownMenu) accountDropdownMenu.classList.remove('hidden');
        if (userInfoBadge) userInfoBadge.classList.add('active');
        if (accountDropdownOverlay) accountDropdownOverlay.classList.remove('hidden');
        document.body.classList.add('dropdown-open-lock');
      }

      function toggleAccountDropdown() {
        if (accountDropdownMenu && accountDropdownMenu.classList.contains('hidden')) {
          openAccountDropdown();
        } else {
          closeAccountDropdown();
        }
      }

      if (accountDropdownOverlay) {
        accountDropdownOverlay.addEventListener('click', closeAccountDropdown);
        accountDropdownOverlay.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
      }

      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          closeAccountDropdown();
          AppState.logout();
        });
      }

      const openAdminPanelBtn = document.getElementById('openAdminPanelBtn');
      if (openAdminPanelBtn) {
        openAdminPanelBtn.addEventListener('click', () => {
          closeAccountDropdown();
          openModal('adminModal');
          fetchAdminUsers();
          fetchAdminFeedbacks();
        });
      }

      const refreshAdminUsersBtn = document.getElementById('refreshAdminUsersBtn');
      if (refreshAdminUsersBtn) {
        refreshAdminUsersBtn.addEventListener('click', () => {
          fetchAdminUsers();
          fetchAdminFeedbacks();
        });
      }

      // ----------------------------------------------------
      // Dropdown Profile Menu & Photo Upload & Feedback
      // ----------------------------------------------------
      const userInfoBadge = document.getElementById('userInfoBadge');
      const accountDropdownMenu = document.getElementById('accountDropdownMenu');
      const triggerPhotoUploadBtn = document.getElementById('triggerPhotoUploadBtn');
      const profileImageInput = document.getElementById('profileImageInput');
      const openFeedbackModalBtn = document.getElementById('openFeedbackModalBtn');
      const feedbackModal = document.getElementById('feedbackModal');
      const feedbackForm = document.getElementById('feedbackForm');
      const refreshAdminFeedbacksBtn = document.getElementById('refreshAdminFeedbacksBtn');
      const toggleSidebarMobileBtn = document.getElementById('toggleSidebarMobileBtn');

      if (userInfoBadge) {
        userInfoBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleAccountDropdown();
        });
      }

      // Mobile: 3-dots button opens account dropdown
      if (toggleSidebarMobileBtn) {
        toggleSidebarMobileBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleAccountDropdown();
        });
      }

      document.addEventListener('click', (e) => {
        if (accountDropdownMenu && !accountDropdownMenu.contains(e.target) &&
          userInfoBadge && !userInfoBadge.contains(e.target) &&
          toggleSidebarMobileBtn && !toggleSidebarMobileBtn.contains(e.target)) {
          closeAccountDropdown();
        }
      });

      if (triggerPhotoUploadBtn && profileImageInput) {
        triggerPhotoUploadBtn.addEventListener('click', () => {
          closeAccountDropdown();
          profileImageInput.click();
        });

        profileImageInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (!file) return;

          if (!file.type.startsWith('image/')) {
            alert('Seleziona un file immagine valido (PNG, JPG, WEBP).');
            return;
          }

          const reader = new FileReader();
          reader.onload = function (evt) {
            const img = new Image();
            img.onload = function () {
              const canvas = document.createElement('canvas');
              const MAX_SIZE = 300;
              let width = img.width;
              let height = img.height;

              if (width > height) {
                if (width > MAX_SIZE) {
                  height *= MAX_SIZE / width;
                  width = MAX_SIZE;
                }
              } else {
                if (height > MAX_SIZE) {
                  width *= MAX_SIZE / height;
                  height = MAX_SIZE;
                }
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, width, height);

              const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

              AppState.avatarUrl = dataUrl;
              localStorage.setItem(STORAGE_KEY_AVATAR, dataUrl);
              AppState.updateAuthUI(true);

              if (AppState.token) {
                fetch(`${API_BASE_URL}/api/user/profile-image`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AppState.token}`
                  },
                  body: JSON.stringify({ avatarDataUrl: dataUrl })
                }).catch(() => { });
              }

              showToast('Foto profilo aggiornata!');
            };
            img.src = evt.target.result;
          };
          reader.readAsDataURL(file);
        });
      }

      if (openFeedbackModalBtn && feedbackModal) {
        openFeedbackModalBtn.addEventListener('click', () => {
          closeAccountDropdown();
          openModal('feedbackModal');
        });
      }

      if (feedbackForm) {
        feedbackForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const type = document.getElementById('feedbackType').value;
          const subject = document.getElementById('feedbackSubject').value;
          const message = document.getElementById('feedbackMessage').value;

          if (!subject.trim() || !message.trim()) {
            alert('Compila sia l\'oggetto che il messaggio.');
            return;
          }

          fetch(`${API_BASE_URL}/api/feedback`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${AppState.token}`
            },
            body: JSON.stringify({ type, subject, message })
          })
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                showToast('Segnalazione inviata con successo all\'amministratore!');
                feedbackModal.classList.add('hidden');
                feedbackForm.reset();
              } else {
                alert('Errore: ' + (data.error || 'Impossibile inviare la segnalazione.'));
              }
            })
            .catch(() => {
              showToast('Segnalazione inviata (notifica salvata).');
              feedbackModal.classList.add('hidden');
              feedbackForm.reset();
            });
        });
      }

      if (refreshAdminFeedbacksBtn) {
        refreshAdminFeedbacksBtn.addEventListener('click', fetchAdminFeedbacks);
      }

      const exportDataBtn = document.getElementById('exportDataBtn');
      if (exportDataBtn) exportDataBtn.addEventListener('click', () => AppState.exportData());

      const importDataBtn = document.getElementById('importDataBtn');
      const importFileInput = document.getElementById('importFileInput');
      if (importDataBtn && importFileInput) {
        importDataBtn.addEventListener('click', () => importFileInput.click());
        importFileInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (event) => AppState.importData(event.target.result);
            reader.readAsText(file);
          }
        });
      }

      const closeSidebarMobileBtn = document.getElementById('closeSidebarMobileBtn');
      const appSidebar = document.getElementById('appSidebar');

      // toggleSidebarMobileBtn now opens account dropdown instead of sidebar (handled below)

      if (closeSidebarMobileBtn && appSidebar) {
        closeSidebarMobileBtn.addEventListener('click', () => {
          appSidebar.classList.remove('open-mobile');
        });
      }

      const addEventBtn = document.getElementById('addEventBtn');
      if (addEventBtn) addEventBtn.addEventListener('click', () => openEventModal());

      const addTaskBtn = document.getElementById('addTaskBtn');
      if (addTaskBtn) addTaskBtn.addEventListener('click', () => openTaskModal());

      const viewMonthBtn = document.getElementById('viewMonthBtn');
      const viewAgendaBtn = document.getElementById('viewAgendaBtn');
      const viewMemoBtn = document.getElementById('viewMemoBtn');
      const viewCycleBtn = document.getElementById('viewCycleBtn');

      function updateHeaderTabActive(view) {
        if (viewMonthBtn) viewMonthBtn.classList.toggle('active', view === 'month');
        if (viewAgendaBtn) viewAgendaBtn.classList.toggle('active', view === 'agenda');
        if (viewMemoBtn) viewMemoBtn.classList.toggle('active', view === 'memo');
        if (viewCycleBtn) viewCycleBtn.classList.toggle('active', view === 'cycle');
      }

      if (viewMonthBtn) viewMonthBtn.addEventListener('click', () => { AppState.currentView = 'month'; updateHeaderTabActive('month'); renderCalendar(); });
      if (viewAgendaBtn) viewAgendaBtn.addEventListener('click', () => { AppState.currentView = 'agenda'; updateHeaderTabActive('agenda'); renderCalendar(); });
      if (viewMemoBtn) viewMemoBtn.addEventListener('click', () => { AppState.currentView = 'memo'; updateHeaderTabActive('memo'); renderCalendar(); });
      if (viewCycleBtn) viewCycleBtn.addEventListener('click', () => { AppState.currentView = 'cycle'; updateHeaderTabActive('cycle'); renderCalendar(); });

      function updateCycleVisibilityUI() {
        const isEnabled = !!(AppState.cycleSettings && AppState.cycleSettings.enabled);
        const viewCycleBtn = document.getElementById('viewCycleBtn');
        const mobileCycleItem = document.querySelector('.bottom-nav-item[data-view="cycle"]');
        const toggleCycleBtnText = document.getElementById('toggleCycleBtnText');

        if (viewCycleBtn) {
          if (isEnabled) viewCycleBtn.classList.remove('hidden');
          else viewCycleBtn.classList.add('hidden');
        }

        if (mobileCycleItem) {
          if (isEnabled) mobileCycleItem.classList.remove('hidden');
          else mobileCycleItem.classList.add('hidden');
        }

        if (toggleCycleBtnText) {
          toggleCycleBtnText.textContent = isEnabled ? 'Disattiva Monitoraggio Ciclo' : 'Attiva Monitoraggio Ciclo';
        }

        if (!isEnabled && AppState.currentView === 'cycle') {
          AppState.currentView = 'month';
          updateHeaderTabActive('month');
          renderCalendar();
        }
      }

      const toggleCycleFeatureBtn = document.getElementById('toggleCycleFeatureBtn');
      if (toggleCycleFeatureBtn) {
        toggleCycleFeatureBtn.addEventListener('click', () => {
          closeAccountDropdown();
          const currentEnabled = AppState.cycleSettings ? AppState.cycleSettings.enabled : false;
          const nextEnabled = !currentEnabled;

          if (nextEnabled) {
            AppState.updateCycleSettings({ enabled: true });
            updateCycleVisibilityUI();
            if (!AppState.cycleSettings.lastPeriodStart) {
              openCycleSettingsModal();
            } else {
              showToast('Monitoraggio Ciclo attivato!');
            }
          } else {
            AppState.updateCycleSettings({ enabled: false });
            updateCycleVisibilityUI();
            showToast('Monitoraggio Ciclo disattivato.', 'info');
          }
        });
      }

      // Cycle Setup & Settings Handlers
      const cycleInitSetupBtn = document.getElementById('cycleInitSetupBtn');
      const openCycleSettingsBtn = document.getElementById('openCycleSettingsBtn');
      const cycleSettingsForm = document.getElementById('cycleSettingsForm');

      function openCycleSettingsModal() {
        const settings = AppState.cycleSettings || {};
        const lastPeriodInput = document.getElementById('cycleLastPeriodStartInput');
        const avgLengthInput = document.getElementById('cycleAvgLengthInput');
        const periodLengthInput = document.getElementById('cyclePeriodLengthInput');
        const lutealLengthInput = document.getElementById('cycleLutealLengthInput');
        const discreteNotifInput = document.getElementById('cycleDiscreteNotificationsInput');

        if (lastPeriodInput) lastPeriodInput.value = settings.lastPeriodStart || formatDateKey(new Date());
        if (avgLengthInput) avgLengthInput.value = settings.avgCycleLength || 28;
        if (periodLengthInput) periodLengthInput.value = settings.avgPeriodLength || 5;
        if (lutealLengthInput) lutealLengthInput.value = settings.lutealPhaseLength || 14;
        if (discreteNotifInput) discreteNotifInput.checked = settings.discreteNotifications !== false;

        openModal('cycleSettingsModal');
      }

      if (cycleInitSetupBtn) cycleInitSetupBtn.addEventListener('click', openCycleSettingsModal);
      if (openCycleSettingsBtn) openCycleSettingsBtn.addEventListener('click', openCycleSettingsModal);

      if (cycleSettingsForm) {
        cycleSettingsForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const lastPeriodStart = document.getElementById('cycleLastPeriodStartInput').value;
          const avgCycleLength = parseInt(document.getElementById('cycleAvgLengthInput').value, 10) || 28;
          const avgPeriodLength = parseInt(document.getElementById('cyclePeriodLengthInput').value, 10) || 5;
          const lutealPhaseLength = parseInt(document.getElementById('cycleLutealLengthInput').value, 10) || 14;
          const discreteNotifications = document.getElementById('cycleDiscreteNotificationsInput').checked;

          AppState.updateCycleSettings({
            enabled: true,
            lastPeriodStart,
            avgCycleLength,
            avgPeriodLength,
            lutealPhaseLength,
            discreteNotifications
          });

          closeModal('cycleSettingsModal');
          renderCalendar();
        });
      }

      const cyclePrevMonthBtn = document.getElementById('cyclePrevMonthBtn');
      const cycleNextMonthBtn = document.getElementById('cycleNextMonthBtn');

      if (cyclePrevMonthBtn) {
        cyclePrevMonthBtn.addEventListener('click', () => {
          currentCycleCalendarDate = new Date(currentCycleCalendarDate.getFullYear(), currentCycleCalendarDate.getMonth() - 1, 1);
          renderCycleCalendarGrid();
        });
      }

      if (cycleNextMonthBtn) {
        cycleNextMonthBtn.addEventListener('click', () => {
          currentCycleCalendarDate = new Date(currentCycleCalendarDate.getFullYear(), currentCycleCalendarDate.getMonth() + 1, 1);
          renderCycleCalendarGrid();
        });
      }

      // Quick Category Filter Pills in Header Toolbar
      document.querySelectorAll('.cat-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');

          const cat = pill.dataset.cat || 'all';
          AppState.filterCategory = cat;

          const selectEl = document.getElementById('filterCategory');
          if (selectEl) selectEl.value = cat;

          renderCalendar();
          renderTasks();
        });
      });

      // Catalog Status Filter Buttons in Dedicated Memo View
      document.querySelectorAll('.btn-filter-sub').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.btn-filter-sub').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          const statusFilter = btn.dataset.statusFilter || 'all';
          AppState.catalogStatusFilter = statusFilter;
          renderCalendar();
        });
      });

      const prevMonthBtn = document.getElementById('prevMonthBtn');
      const nextMonthBtn = document.getElementById('nextMonthBtn');
      const todayBtn = document.getElementById('todayBtn');

      if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', () => {
          const d = AppState.currentDate;
          AppState.currentDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
          renderCalendar();
        });
      }

      if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', () => {
          const d = AppState.currentDate;
          AppState.currentDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
          renderCalendar();
        });
      }

      if (todayBtn) {
        todayBtn.addEventListener('click', () => {
          AppState.currentDate = new Date();
          renderCalendar();
        });
      }

      const tabUndatedMemo = document.getElementById('tabUndatedMemo');
      const tabAllTasks = document.getElementById('tabAllTasks');

      if (tabUndatedMemo && tabAllTasks) {
        tabUndatedMemo.addEventListener('click', () => {
          AppState.sidebarTab = 'undated';
          tabUndatedMemo.classList.add('active');
          tabAllTasks.classList.remove('active');
          renderTasks();
        });

        tabAllTasks.addEventListener('click', () => {
          AppState.sidebarTab = 'all';
          tabAllTasks.classList.add('active');
          tabUndatedMemo.classList.remove('active');
          renderTasks();
        });
      }

      const filterCategory = document.getElementById('filterCategory');
      if (filterCategory) {
        filterCategory.addEventListener('change', (e) => {
          AppState.filterCategory = e.target.value;
          renderCalendar();
          renderTasks();
        });
      }

      const filterUrgency = document.getElementById('filterUrgency');
      if (filterUrgency) {
        filterUrgency.addEventListener('change', (e) => {
          AppState.filterUrgency = e.target.value;
          renderCalendar();
          renderTasks();
        });
      }

      const searchInput = document.getElementById('taskSearchInput');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          AppState.searchQuery = e.target.value;
          renderCalendar();
          renderTasks();
        });
      }

      document.querySelectorAll('.urgency-card').forEach(card => {
        card.addEventListener('click', () => {
          const selectedUrgency = card.dataset.urgency;
          if (filterUrgency) {
            if (filterUrgency.value === selectedUrgency) {
              filterUrgency.value = 'all';
              AppState.filterUrgency = 'all';
            } else {
              filterUrgency.value = selectedUrgency;
              AppState.filterUrgency = selectedUrgency;
            }
            renderCalendar();
            renderTasks();
          }
        });
      });

      // ==========================================
      // PWA: Install Banner, Offline Retry, Notifiche
      // ==========================================
      let deferredInstallPrompt = null;
      const installBanner = document.getElementById('installBanner');
      const installBannerBtn = document.getElementById('installBannerBtn');
      const installBannerDismissBtn = document.getElementById('installBannerDismissBtn');

      let installPromptFired = false;
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        installPromptFired = true;
        if (installBanner && !localStorage.getItem('chronos_install_dismissed_v1')) {
          installBanner.classList.remove('hidden');
        }
      });

      // Fallback: show banner after 8s if beforeinstallprompt never fired (e.g., iOS/Safari)
      setTimeout(() => {
        if (!installPromptFired && installBanner && !localStorage.getItem('chronos_install_dismissed_v1')) {
          installBanner.classList.remove('hidden');
        }
      }, 8000);

      if (installBannerBtn) {
        installBannerBtn.addEventListener('click', async () => {
          if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            if (installBanner) installBanner.classList.add('hidden');
          } else {
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            if (isIOS) {
              alert('Per installare Planner su iPhone/iPad:\n\n1. Tocca l\'icona Condividi (in basso al centro su Safari)\n2. Scorri in basso e seleziona "Aggiungi alla schermata Home"');
            } else {
              alert('Per installare l\'app:\n\nApri il menu opzioni del browser (i 3 punti in alto a destra) e seleziona "Installa app" o "Aggiungi a schermata Home".');
            }
            if (installBanner) installBanner.classList.add('hidden');
          }
        });
      }

      if (installBannerDismissBtn) {
        installBannerDismissBtn.addEventListener('click', () => {
          if (installBanner) installBanner.classList.add('hidden');
          localStorage.setItem('chronos_install_dismissed_v1', '1');
        });
      }

      window.addEventListener('appinstalled', () => {
        showToast('Planner installato con successo.');
        if (installBanner) installBanner.classList.add('hidden');
      });

      window.addEventListener('offline', () => {
        showToast('Sei offline. Le modifiche verranno sincronizzate al ripristino della connessione.', 'danger');
      });

      window.addEventListener('online', () => {
        if (AppState.token && AppState.hasPendingSync) {
          AppState.pushToRedis();
          showToast('Connessione ripristinata: sincronizzazione in corso.');
        }
      });

      const enableNotifBtn = document.getElementById('enableNotificationsBtn');
      const enableNotifBtnText = document.getElementById('enableNotifBtnText');
      const testPushBtn = document.getElementById('testPushNotificationBtn');

      function updatePushUIState() {
        if (!('Notification' in window)) {
          if (enableNotifBtn) enableNotifBtn.classList.add('hidden');
          if (testPushBtn) testPushBtn.classList.add('hidden');
          return;
        }
        if (Notification.permission === 'granted') {
          if (enableNotifBtnText) enableNotifBtnText.textContent = 'Notifiche Push Attive ✔️';
        } else {
          if (enableNotifBtnText) enableNotifBtnText.textContent = 'Abilita Notifiche Push';
        }
      }

      updatePushUIState();

      if (enableNotifBtn) {
        enableNotifBtn.addEventListener('click', () => {
          if (!('Notification' in window)) {
            showToast('Le notifiche non sono supportate da questo browser.', 'danger');
            return;
          }

          Notification.requestPermission().then(async permission => {
            if (permission === 'granted') {
              updatePushUIState();
              checkAndNotify();
              setInterval(checkAndNotify, 5 * 60 * 1000);

              try {
                await setupPushNotifications();
              } catch (err) {
                console.warn('Avviso registrazione Push:', err);
                showToast('Notifiche locali attive. Su iOS salva l\'app sulla Home per le notifiche ad app chiusa.');
              }
            } else {
              updatePushUIState();
              showToast('Permesso notifiche negato.', 'danger');
            }
          });
        });

        if (Notification.permission === 'granted') {
          checkAndNotify();
          setInterval(checkAndNotify, 5 * 60 * 1000);
          if (AppState.token) {
            setupPushNotifications().catch(() => { });
          }
        }
      }

      if (testPushBtn) {
        testPushBtn.addEventListener('click', () => {
          testPushNotification();
        });
      }

      renderCalendar();
      renderTasks();

      // ==========================================
      // 7. MOBILE INTERACTIONS
      // ==========================================
      initMobileInteractions();
    });

    // ==========================================
    // MOBILE: Bottom Nav, FAB, Sidebar, Swipe
    // ==========================================
    function initMobileInteractions() {
      const sidebarOverlay = document.getElementById('sidebarOverlay');
      const appSidebar = document.getElementById('appSidebar');
      const fabMainBtn = document.getElementById('fabMainBtn');
      const fabSpeedDial = document.getElementById('fabSpeedDial');
      const fabOptionEvent = document.getElementById('fabOptionEvent');
      const fabOptionMemo = document.getElementById('fabOptionMemo');
      const mobileBottomNav = document.getElementById('mobileBottomNav');
      const bottomNavSidebarBtn = document.getElementById('bottomNavSidebarBtn');
      const calendarGrid = document.getElementById('calendarGrid');

      // --- Sidebar Overlay: close on tap ---
      if (sidebarOverlay && appSidebar) {
        sidebarOverlay.addEventListener('click', () => {
          closeMobileSidebar();
        });
      }

      // toggleSidebarMobileBtn now opens account dropdown (defined earlier with userInfoBadge handler)

      const closeSidebarMobileBtn = document.getElementById('closeSidebarMobileBtn');
      if (closeSidebarMobileBtn) {
        closeSidebarMobileBtn.addEventListener('click', () => {
          closeMobileSidebar();
        });
      }

      // Bottom nav sidebar button
      if (bottomNavSidebarBtn) {
        bottomNavSidebarBtn.addEventListener('click', () => {
          openMobileSidebar();
        });
      }

      function openMobileSidebar() {
        if (appSidebar) appSidebar.classList.add('open-mobile');
        if (sidebarOverlay) {
          sidebarOverlay.classList.add('visible');
        }
        // Prevent body scroll
        document.body.style.overflow = 'hidden';
      }

      function closeMobileSidebar() {
        if (appSidebar) appSidebar.classList.remove('open-mobile');
        if (sidebarOverlay) {
          sidebarOverlay.classList.remove('visible');
        }
        document.body.style.overflow = '';
      }

      // --- FAB Speed Dial ---
      if (fabMainBtn && fabSpeedDial) {
        fabMainBtn.addEventListener('click', () => {
          const isOpen = fabSpeedDial.classList.contains('open');
          if (isOpen) {
            closeFab();
          } else {
            fabSpeedDial.classList.add('open');
            fabMainBtn.classList.add('open');
          }
        });

        // Close FAB when clicking outside
        document.addEventListener('click', (e) => {
          if (!fabMainBtn.contains(e.target) && !fabSpeedDial.contains(e.target)) {
            closeFab();
          }
        });
      }

      function closeFab() {
        if (fabSpeedDial) fabSpeedDial.classList.remove('open');
        if (fabMainBtn) fabMainBtn.classList.remove('open');
      }

      if (fabOptionEvent) {
        fabOptionEvent.addEventListener('click', () => {
          closeFab();
          openEventModal();
        });
      }

      if (fabOptionMemo) {
        fabOptionMemo.addEventListener('click', () => {
          closeFab();
          openTaskModal();
        });
      }

      // --- Bottom Navigation: View Switching ---
      if (mobileBottomNav) {
        const navItems = mobileBottomNav.querySelectorAll('.bottom-nav-item[data-view]');
        navItems.forEach(item => {
          item.addEventListener('click', () => {
            const view = item.dataset.view;
            if (!view) return;

            // Update bottom nav active state
            mobileBottomNav.querySelectorAll('.bottom-nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Sync with header view buttons
            AppState.currentView = view;
            const viewMonthBtn = document.getElementById('viewMonthBtn');
            const viewAgendaBtn = document.getElementById('viewAgendaBtn');
            const viewMemoBtn = document.getElementById('viewMemoBtn');
            const viewCycleBtn = document.getElementById('viewCycleBtn');
            if (viewMonthBtn) viewMonthBtn.classList.toggle('active', view === 'month');
            if (viewAgendaBtn) viewAgendaBtn.classList.toggle('active', view === 'agenda');
            if (viewMemoBtn) viewMemoBtn.classList.toggle('active', view === 'memo');
            if (viewCycleBtn) viewCycleBtn.classList.toggle('active', view === 'cycle');

            renderCalendar();
            closeFab();
          });
        });
      }

      // --- Swipe Gesture for Month Navigation ---
      if (calendarGrid) {
        let touchStartX = 0;
        let touchStartY = 0;
        let isSwiping = false;

        calendarGrid.addEventListener('touchstart', (e) => {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          isSwiping = true;
        }, { passive: true });

        calendarGrid.addEventListener('touchend', (e) => {
          if (!isSwiping) return;
          isSwiping = false;

          const touchEndX = e.changedTouches[0].clientX;
          const touchEndY = e.changedTouches[0].clientY;
          const diffX = touchEndX - touchStartX;
          const diffY = touchEndY - touchStartY;

          // Minimum swipe distance 60px, and more horizontal than vertical
          if (Math.abs(diffX) > 60 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
            if (diffX < 0) {
              // Swipe left = next month
              const d = AppState.currentDate;
              AppState.currentDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
              calendarGrid.classList.add('slide-left');
            } else {
              // Swipe right = prev month
              const d = AppState.currentDate;
              AppState.currentDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
              calendarGrid.classList.add('slide-right');
            }

            renderCalendar();

            // Remove animation class after it finishes
            setTimeout(() => {
              calendarGrid.classList.remove('slide-left', 'slide-right');
            }, 350);
          }
        }, { passive: true });
      }

      // --- Bottom Sheet Drag to Close ---
      if (appSidebar) {
        let sheetStartY = 0;
        let sheetIsDragging = false;

        const handleEl = appSidebar.querySelector('.bottom-sheet-handle');
        if (handleEl) {
          handleEl.addEventListener('touchstart', (e) => {
            sheetStartY = e.touches[0].clientY;
            sheetIsDragging = true;
            appSidebar.style.transition = 'none';
          }, { passive: true });

          handleEl.addEventListener('touchmove', (e) => {
            if (!sheetIsDragging) return;
            const currentY = e.touches[0].clientY;
            const diffY = currentY - sheetStartY;
            if (diffY > 0) {
              appSidebar.style.transform = `translateY(${diffY}px)`;
            }
          }, { passive: true });

          handleEl.addEventListener('touchend', (e) => {
            if (!sheetIsDragging) return;
            sheetIsDragging = false;
            appSidebar.style.transition = '';

            const endY = e.changedTouches[0].clientY;
            const diffY = endY - sheetStartY;

            if (diffY > 100) {
              // Dragged down enough — close
              closeMobileSidebar();
            } else {
              // Snap back
              appSidebar.style.transform = '';
            }
          }, { passive: true });
        }
      }

      // --- Sync bottom nav with header view changes (from desktop listeners) ---
      function syncBottomNav(view) {
        if (!mobileBottomNav) return;
        mobileBottomNav.querySelectorAll('.bottom-nav-item').forEach(item => {
          item.classList.toggle('active', item.dataset.view === view);
        });
      }

      // Override the header view button clicks to also sync bottom nav
      const viewMonthBtn = document.getElementById('viewMonthBtn');
      const viewAgendaBtn = document.getElementById('viewAgendaBtn');
      const viewMemoBtn = document.getElementById('viewMemoBtn');

      if (viewMonthBtn) viewMonthBtn.addEventListener('click', () => syncBottomNav('month'));
      if (viewAgendaBtn) viewAgendaBtn.addEventListener('click', () => syncBottomNav('agenda'));
      if (viewMemoBtn) viewMemoBtn.addEventListener('click', () => syncBottomNav('memo'));
    }
  }) ();
