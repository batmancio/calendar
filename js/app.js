/**
 * Chronos - Application Core (Account Authentication & Redis Cloud Sync)
 * Gestisce State Management, Calendar Engine, Task Engine, Modals, Autenticazione Utenti e Sync con Redis.
 */

(function () {
  'use strict';

  const STORAGE_KEY_EVENTS = 'chronos_app_events_v1';
  const STORAGE_KEY_TASKS = 'chronos_app_tasks_v1';
  const STORAGE_KEY_TOKEN = 'chronos_jwt_token_v1';
  const STORAGE_KEY_USER = 'chronos_username_v1';

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

  function escapeHtml(str) {
    return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function showToast(msg, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  // ==========================================
  // 1. STATO GLOBALE (AppState) & AUTENTICAZIONE REDIS
  // ==========================================
  const AppState = {
    currentDate: new Date(),
    currentView: 'month',
    sidebarTab: 'undated',
    filterCategory: 'all',
    filterUrgency: 'all',
    searchQuery: '',

    events: [],
    tasks: [],

    token: null,
    username: null,
    syncIntervalId: null,

    listeners: [],

    subscribe(listener) {
      this.listeners.push(listener);
    },

    notify() {
      this.listeners.forEach(fn => fn(this));
    },

    init() {
      this.loadFromStorage();
      if (this.events.length === 0 && this.tasks.length === 0) {
        this.loadDemoData();
      }
      this.checkAuthSession();
    },

    loadFromStorage() {
      try {
        const storedEvents = localStorage.getItem(STORAGE_KEY_EVENTS);
        const storedTasks = localStorage.getItem(STORAGE_KEY_TASKS);
        this.token = localStorage.getItem(STORAGE_KEY_TOKEN) || null;
        this.username = localStorage.getItem(STORAGE_KEY_USER) || null;

        this.events = storedEvents ? JSON.parse(storedEvents) : [];
        this.tasks = storedTasks ? JSON.parse(storedTasks) : [];
      } catch (e) {
        console.error('Errore nel caricamento da localStorage:', e);
        this.events = [];
        this.tasks = [];
      }
    },

    saveToStorage(skipRedisSync = false) {
      try {
        localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(this.events));
        localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(this.tasks));
      } catch (e) {
        console.error('Errore nel salvataggio in localStorage:', e);
      }

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
          title: 'Kickoff Riunione di Progetto',
          date: todayStr,
          timeStart: '10:00',
          timeEnd: '11:30',
          category: 'lavoro',
          description: 'Revisione deliverable con il team'
        },
        {
          id: 'evt_demo_2',
          title: 'Visita Medica di Controllo',
          date: tomorrowStr,
          timeStart: '15:00',
          timeEnd: '16:00',
          category: 'salute',
          description: 'Appuntamento in clinica'
        },
        {
          id: 'evt_demo_3',
          title: 'Esame Corso AI & ML',
          date: nextWeekStr,
          timeStart: '09:00',
          timeEnd: '12:00',
          category: 'studio',
          description: 'Sessione di verifica online'
        }
      ];

      this.tasks = [
        {
          id: 'task_demo_1',
          title: 'Revisione contabilità e fatture mese',
          urgency: 'critical',
          category: 'finanza',
          dueDate: null,
          status: 'todo',
          description: 'Controllare scadenze F24 e invio fatture elettroniche.'
        },
        {
          id: 'task_demo_2',
          title: 'Preparare la presentazione del cliente',
          urgency: 'high',
          category: 'lavoro',
          dueDate: todayStr,
          status: 'in_progress',
          description: 'Includere grafici di performance e slide introduttive.'
        },
        {
          id: 'task_demo_3',
          title: 'Ordinare nuovo materiale di studio',
          urgency: 'medium',
          category: 'studio',
          dueDate: null,
          status: 'todo',
          description: 'Acquistare manuali aggiornati per i prossimi esami.'
        },
        {
          id: 'task_demo_4',
          title: 'Prenotare tagliando auto',
          urgency: 'low',
          category: 'personale',
          dueDate: tomorrowStr,
          status: 'todo',
          description: 'Chiamare l’officina per la prossima settimana.'
        }
      ];

      this.saveToStorage(true);
    },

    // Autenticazione & Redis Sync
    checkAuthSession() {
      if (this.token && this.username) {
        this.updateAuthUI(true);
        this.pullFromRedis();
        this.startRedisPolling();
      } else {
        this.updateAuthUI(false);
      }
    },

    setSession(username, token) {
      this.username = username;
      this.token = token;
      localStorage.setItem(STORAGE_KEY_USER, username);
      localStorage.setItem(STORAGE_KEY_TOKEN, token);
      this.updateAuthUI(true);
      
      // Sincronizza subito con Redis
      this.pushToRedis();
      this.startRedisPolling();
      showToast(`Benvenuto, ${username}! Account connesso a Redis.`);
    },

    logout() {
      this.username = null;
      this.token = null;
      localStorage.removeItem(STORAGE_KEY_USER);
      localStorage.removeItem(STORAGE_KEY_TOKEN);
      if (this.syncIntervalId) clearInterval(this.syncIntervalId);
      this.updateAuthUI(false);
      showToast('Disconnessione effettuata. Modalità locale.');
    },

    updateAuthUI(isLoggedIn) {
      const openBtn = document.getElementById('openAuthModalBtn');
      const badge = document.getElementById('userInfoBadge');
      const label = document.getElementById('currentUsernameLabel');

      if (isLoggedIn) {
        if (openBtn) openBtn.classList.add('hidden');
        if (badge) badge.classList.remove('hidden');
        if (label) label.textContent = this.username;
      } else {
        if (openBtn) openBtn.classList.remove('hidden');
        if (badge) badge.classList.add('hidden');
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
      fetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          events: this.events,
          tasks: this.tasks
        })
      }).catch(err => console.log('Redis Push Sync Note:', err));
    },

    pullFromRedis() {
      if (!this.token) return;
      fetch('/api/sync', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.success) {
            this.events = data.events || [];
            this.tasks = data.tasks || [];
            this.saveToStorage(true);
          }
        })
        .catch(err => console.log('Redis Pull Sync Note:', err));
    },

    // Operazioni Eventi
    addEvent(eventData) {
      const newEvent = { id: 'evt_' + Date.now(), ...eventData };
      this.events.push(newEvent);
      this.saveToStorage();
      showToast('Evento creato con successo!');
      return newEvent;
    },

    updateEvent(id, eventData) {
      const idx = this.events.findIndex(e => e.id === id);
      if (idx !== -1) {
        this.events[idx] = { ...this.events[idx], ...eventData };
        this.saveToStorage();
        showToast('Evento aggiornato!');
      }
    },

    deleteEvent(id) {
      this.events = this.events.filter(e => e.id !== id);
      this.saveToStorage();
      showToast('Evento eliminato.', 'danger');
    },

    // Operazioni Task / Memo
    addTask(taskData) {
      const newTask = { id: 'task_' + Date.now(), status: 'todo', ...taskData };
      this.tasks.push(newTask);
      this.saveToStorage();
      showToast('Memo/Task salvata!');
      return newTask;
    },

    updateTask(id, taskData) {
      const idx = this.tasks.findIndex(t => t.id === id);
      if (idx !== -1) {
        this.tasks[idx] = { ...this.tasks[idx], ...taskData };
        this.saveToStorage();
        showToast('Task aggiornata!');
      }
    },

    deleteTask(id) {
      this.tasks = this.tasks.filter(t => t.id !== id);
      this.saveToStorage();
      showToast('Task eliminata.', 'danger');
    },

    toggleTaskStatus(id) {
      const task = this.tasks.find(t => t.id === id);
      if (task) {
        task.status = task.status === 'completed' ? 'todo' : 'completed';
        this.saveToStorage();
      }
    },

    assignTaskDate(id, dateStr) {
      const task = this.tasks.find(t => t.id === id);
      if (task) {
        task.dueDate = dateStr;
        this.saveToStorage();
      }
    },

    // Backup JSON
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
      showToast('Backup JSON scaricato!');
    },

    importData(jsonContent) {
      try {
        const parsed = JSON.parse(jsonContent);
        if (Array.isArray(parsed.events) && Array.isArray(parsed.tasks)) {
          this.events = parsed.events;
          this.tasks = parsed.tasks;
          this.saveToStorage();
          showToast('Dati importati con successo!');
        } else {
          alert('Il file selezionato non contiene un backup Chronos valido.');
        }
      } catch (e) {
        alert('Errore nella lettura del file JSON: ' + e.message);
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
  function renderCalendar() {
    const currentMonthYearLabel = document.getElementById('currentMonthYearLabel');
    const calendarGrid = document.getElementById('calendarGrid');
    const agendaList = document.getElementById('agendaList');

    const viewMonthContainer = document.getElementById('calendarViewContainer');
    const viewAgendaContainer = document.getElementById('agendaViewContainer');

    const currDate = AppState.currentDate;
    const year = currDate.getFullYear();
    const month = currDate.getMonth();

    if (currentMonthYearLabel) {
      currentMonthYearLabel.textContent = `${MONTH_NAMES_IT[month]} ${year}`;
    }

    if (AppState.currentView === 'month') {
      viewMonthContainer.classList.remove('hidden');
      viewAgendaContainer.classList.add('hidden');
      renderMonthGrid(calendarGrid, year, month);
    } else {
      viewMonthContainer.classList.add('hidden');
      viewAgendaContainer.classList.remove('hidden');
      renderAgendaList(agendaList);
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

      cell.dataset.date = cellDateStr;

      const cellHeader = document.createElement('div');
      cellHeader.className = 'cell-header';

      const dayNumSpan = document.createElement('span');
      dayNumSpan.className = 'cell-day-num';
      dayNumSpan.textContent = displayDayNum;

      const addBtn = document.createElement('button');
      addBtn.className = 'cell-add-btn';
      addBtn.innerHTML = '+';
      addBtn.title = `Aggiungi evento per il ${cellDateStr}`;
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEventModal({ date: cellDateStr });
      });

      cellHeader.appendChild(dayNumSpan);
      cellHeader.appendChild(addBtn);
      cell.appendChild(cellHeader);

      const eventsContainer = document.createElement('div');
      eventsContainer.className = 'cell-events-container';

      const dayEvents = AppState.events.filter(e => {
        if (AppState.filterCategory !== 'all' && e.category !== AppState.filterCategory) return false;
        if (AppState.searchQuery.trim()) {
          const q = AppState.searchQuery.toLowerCase();
          return e.title.toLowerCase().includes(q) || (e.description && e.description.toLowerCase().includes(q));
        }
        return e.date === cellDateStr;
      });

      dayEvents.forEach(evt => {
        const evtEl = document.createElement('div');
        evtEl.className = `cell-item event-item cat-${evt.category}`;
        evtEl.innerHTML = `<span class="time">${evt.timeStart || ''}</span> ${escapeHtml(evt.title)}`;
        evtEl.addEventListener('click', (e) => {
          e.stopPropagation();
          openEventModal(evt);
        });
        eventsContainer.appendChild(evtEl);
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
        eventsContainer.appendChild(taskEl);
      });

      cell.appendChild(eventsContainer);
      setupCellDragAndDrop(cell, cellDateStr);

      container.appendChild(cell);
    }
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
        showToast(`Task programmata per il ${dateStr}`, 'success');
      }
    });
  }

  function renderAgendaList(container) {
    if (!container) return;
    container.innerHTML = '';

    const itemsByDate = {};

    AppState.events.forEach(evt => {
      if (!itemsByDate[evt.date]) itemsByDate[evt.date] = [];
      itemsByDate[evt.date].push({ type: 'event', data: evt });
    });

    AppState.tasks.forEach(task => {
      if (task.dueDate) {
        if (!itemsByDate[task.dueDate]) itemsByDate[task.dueDate] = [];
        itemsByDate[task.dueDate].push({ type: 'task', data: task });
      }
    });

    const sortedDates = Object.keys(itemsByDate).sort();

    if (sortedDates.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">Nessun evento o task programmata.</div>`;
      return;
    }

    sortedDates.forEach(dateStr => {
      const groupEl = document.createElement('div');
      groupEl.className = 'agenda-day-group';

      const headerEl = document.createElement('div');
      headerEl.className = 'agenda-day-header';
      headerEl.innerHTML = `<span>📅 ${formatDateItalian(dateStr)}</span> <small style="color: var(--text-dim);">${itemsByDate[dateStr].length} elementi</small>`;

      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'agenda-items-container';

      itemsByDate[dateStr].forEach(item => {
        const itemCard = document.createElement('div');
        itemCard.className = 'agenda-item-card';

        if (item.type === 'event') {
          const evt = item.data;
          itemCard.innerHTML = `
            <div>
              <strong style="color: var(--text-main);">${escapeHtml(evt.title)}</strong>
              <div style="font-size: 0.78rem; color: var(--text-muted);">${evt.timeStart ? evt.timeStart + ' - ' + evt.timeEnd : 'Tutto il giorno'} | Categoria: ${evt.category}</div>
            </div>
            <span class="urgency-badge" style="background: rgba(99,102,241,0.2); color: var(--accent-primary);">Evento</span>
          `;
          itemCard.addEventListener('click', () => openEventModal(evt));
        } else {
          const task = item.data;
          itemCard.innerHTML = `
            <div>
              <strong style="color: var(--text-main); ${task.status === 'completed' ? 'text-decoration: line-through; color: var(--text-dim);' : ''}">${escapeHtml(task.title)}</strong>
              <div style="font-size: 0.78rem; color: var(--text-muted);">Urgenza: ${task.urgency.toUpperCase()} | Stato: ${task.status}</div>
            </div>
            <span class="urgency-badge ${task.urgency}">${task.urgency}</span>
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

  function formatDateItalian(dateStr) {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
        <div style="text-align: center; color: var(--text-muted); padding: 30px 10px; font-size: 0.85rem;">
          Nessun memo o task trovata.
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
      const categoryIcons = {
        lavoro: '💼', personale: '🏠', studio: '📚',
        salute: '❤️', finanza: '💰', altro: '📌'
      };

      const catIcon = categoryIcons[task.category] || '📌';
      const dateText = task.dueDate ? `📅 ${task.dueDate}` : '📌 Memo Sospeso';

      card.innerHTML = `
        <div class="task-card-header">
          <div class="task-checkbox-title">
            <input type="checkbox" class="task-checkbox" ${isChecked ? 'checked' : ''} data-id="${task.id}">
            <span class="task-title">${escapeHtml(task.title)}</span>
          </div>
          <span class="urgency-badge ${task.urgency}">${task.urgency}</span>
        </div>

        <div class="task-card-footer">
          <span class="category-tag">${catIcon} ${capitalize(task.category)}</span>
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
  // 4. MODALS & FORMS
  // ==========================================
  function initModals() {
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
        if (eventId && confirm('Sei sicuro di voler eliminare questo evento?')) {
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
        if (taskId && confirm('Sei sicuro di voler eliminare questa task/memo?')) {
          AppState.deleteTask(taskId);
          closeModal('taskModal');
        }
      });
    }

    // Modal Autenticazione (Tabs & Form Handlers)
    const tabAuthLogin = document.getElementById('tabAuthLogin');
    const tabAuthRegister = document.getElementById('tabAuthRegister');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    if (tabAuthLogin && tabAuthRegister && loginForm && registerForm) {
      tabAuthLogin.addEventListener('click', () => {
        tabAuthLogin.classList.add('active');
        tabAuthRegister.classList.remove('active');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
      });

      tabAuthRegister.addEventListener('click', () => {
        tabAuthRegister.classList.add('active');
        tabAuthLogin.classList.remove('active');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
      });
    }

    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;
        const errorMsg = document.getElementById('loginErrorMsg');
        if (errorMsg) errorMsg.classList.add('hidden');

        fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              AppState.setSession(data.username, data.token);
              closeModal('authModal');
            } else {
              if (errorMsg) {
                errorMsg.textContent = data.error || 'Errore nel Login.';
                errorMsg.classList.remove('hidden');
              }
            }
          })
          .catch(err => {
            if (errorMsg) {
              errorMsg.textContent = 'Impossibile contattare il server. Avvia "node server.js".';
              errorMsg.classList.remove('hidden');
            }
          });
      });
    }

    if (registerForm) {
      registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('regUsername').value;
        const password = document.getElementById('regPassword').value;
        const errorMsg = document.getElementById('regErrorMsg');
        if (errorMsg) errorMsg.classList.add('hidden');

        fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              AppState.setSession(data.username, data.token);
              closeModal('authModal');
            } else {
              if (errorMsg) {
                errorMsg.textContent = data.error || 'Errore nella registrazione.';
                errorMsg.classList.remove('hidden');
              }
            }
          })
          .catch(err => {
            if (errorMsg) {
              errorMsg.textContent = 'Impossibile contattare il server. Avvia "node server.js".';
              errorMsg.classList.remove('hidden');
            }
          });
      });
    }
  }

  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden');
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
  }

  function openEventModal(initialData = {}) {
    const modalTitle = document.getElementById('eventModalTitle');
    const eventIdInput = document.getElementById('eventId');
    const titleInput = document.getElementById('eventTitle');
    const dateInput = document.getElementById('eventDate');
    const timeStartInput = document.getElementById('eventTimeStart');
    const timeEndInput = document.getElementById('eventTimeEnd');
    const categoryInput = document.getElementById('eventCategory');
    const descInput = document.getElementById('eventDescription');
    const deleteBtn = document.getElementById('deleteEventBtn');

    if (initialData.id) {
      modalTitle.textContent = 'Modifica Evento';
      eventIdInput.value = initialData.id;
      titleInput.value = initialData.title || '';
      dateInput.value = initialData.date || formatDateKey(new Date());
      timeStartInput.value = initialData.timeStart || '09:00';
      timeEndInput.value = initialData.timeEnd || '10:00';
      categoryInput.value = initialData.category || 'lavoro';
      descInput.value = initialData.description || '';
      deleteBtn.classList.remove('hidden');
    } else {
      modalTitle.textContent = 'Nuovo Evento';
      eventIdInput.value = '';
      titleInput.value = '';
      dateInput.value = initialData.date || formatDateKey(new Date());
      timeStartInput.value = '09:00';
      timeEndInput.value = '10:00';
      categoryInput.value = 'lavoro';
      descInput.value = '';
      deleteBtn.classList.add('hidden');
    }

    openModal('eventModal');
  }

  function handleEventSubmit(e) {
    e.preventDefault();
    const eventId = document.getElementById('eventId').value;
    const eventData = {
      title: document.getElementById('eventTitle').value.trim(),
      date: document.getElementById('eventDate').value,
      timeStart: document.getElementById('eventTimeStart').value,
      timeEnd: document.getElementById('eventTimeEnd').value,
      category: document.getElementById('eventCategory').value,
      description: document.getElementById('eventDescription').value.trim()
    };

    if (eventId) {
      AppState.updateEvent(eventId, eventData);
    } else {
      AppState.addEvent(eventData);
    }

    closeModal('eventModal');
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

    if (initialData.id) {
      modalTitle.textContent = 'Modifica Memo / Task';
      taskIdInput.value = initialData.id;
      titleInput.value = initialData.title || '';
      urgencyInput.value = initialData.urgency || 'medium';
      categoryInput.value = initialData.category || 'altro';
      dueDateInput.value = initialData.dueDate || '';
      statusInput.value = initialData.status || 'todo';
      descInput.value = initialData.description || '';
      deleteBtn.classList.remove('hidden');
    } else {
      modalTitle.textContent = 'Nuovo Memo / Task';
      taskIdInput.value = '';
      titleInput.value = '';
      urgencyInput.value = initialData.urgency || 'medium';
      categoryInput.value = 'altro';
      dueDateInput.value = initialData.dueDate || '';
      statusInput.value = 'todo';
      descInput.value = '';
      deleteBtn.classList.add('hidden');
    }

    openModal('taskModal');
  }

  function handleTaskSubmit(e) {
    e.preventDefault();
    const taskId = document.getElementById('taskId').value;
    const taskData = {
      title: document.getElementById('taskTitle').value.trim(),
      urgency: document.getElementById('taskUrgency').value,
      category: document.getElementById('taskCategory').value,
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

  // ==========================================
  // 5. INIZIALIZZAZIONE & EVENT LISTENERS
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    AppState.init();
    initModals();

    AppState.subscribe(() => {
      renderCalendar();
      renderTasks();
    });

    // Pulsante Modal Autenticazione
    const openAuthModalBtn = document.getElementById('openAuthModalBtn');
    if (openAuthModalBtn) {
      openAuthModalBtn.addEventListener('click', () => openModal('authModal'));
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => AppState.logout());
    }

    // Pulsanti Backup
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

    // Toggle Mobile Sidebar Drawer
    const toggleSidebarMobileBtn = document.getElementById('toggleSidebarMobileBtn');
    const closeSidebarMobileBtn = document.getElementById('closeSidebarMobileBtn');
    const appSidebar = document.getElementById('appSidebar');

    if (toggleSidebarMobileBtn && appSidebar) {
      toggleSidebarMobileBtn.addEventListener('click', () => {
        appSidebar.classList.add('open-mobile');
      });
    }

    if (closeSidebarMobileBtn && appSidebar) {
      closeSidebarMobileBtn.addEventListener('click', () => {
        appSidebar.classList.remove('open-mobile');
      });
    }

    // Header Actions
    const addEventBtn = document.getElementById('addEventBtn');
    if (addEventBtn) addEventBtn.addEventListener('click', () => openEventModal());

    const addTaskBtn = document.getElementById('addTaskBtn');
    if (addTaskBtn) addTaskBtn.addEventListener('click', () => openTaskModal());

    const viewMonthBtn = document.getElementById('viewMonthBtn');
    const viewAgendaBtn = document.getElementById('viewAgendaBtn');

    if (viewMonthBtn && viewAgendaBtn) {
      viewMonthBtn.addEventListener('click', () => {
        AppState.currentView = 'month';
        viewMonthBtn.classList.add('active');
        viewAgendaBtn.classList.remove('active');
        renderCalendar();
      });

      viewAgendaBtn.addEventListener('click', () => {
        AppState.currentView = 'agenda';
        viewAgendaBtn.classList.add('active');
        viewMonthBtn.classList.remove('active');
        renderCalendar();
      });
    }

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

    renderCalendar();
    renderTasks();
  });
})();
