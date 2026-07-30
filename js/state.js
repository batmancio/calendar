/**
 * Chronos State Management Module
 * Gestisce la memorizzazione, l'aggiornamento e la persistenza in localStorage per Eventi e Task/Memo.
 */

const STORAGE_KEY_EVENTS = 'chronos_app_events_v1';
const STORAGE_KEY_TASKS = 'chronos_app_tasks_v1';

// Formattazione data YYYY-MM-DD
export function formatDateKey(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Stato Globale dell'App
export const AppState = {
  currentDate: new Date(),
  currentView: 'month', // 'month' | 'agenda'
  sidebarTab: 'undated', // 'undated' | 'all'
  filterCategory: 'all',
  filterUrgency: 'all',
  searchQuery: '',

  events: [],
  tasks: [],

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
  },

  loadFromStorage() {
    try {
      const storedEvents = localStorage.getItem(STORAGE_KEY_EVENTS);
      const storedTasks = localStorage.getItem(STORAGE_KEY_TASKS);

      this.events = storedEvents ? JSON.parse(storedEvents) : [];
      this.tasks = storedTasks ? JSON.parse(storedTasks) : [];
    } catch (e) {
      console.error('Errore nel caricamento da localStorage:', e);
      this.events = [];
      this.tasks = [];
    }
  },

  saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(this.events));
      localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(this.tasks));
    } catch (e) {
      console.error('Errore nel salvataggio in localStorage:', e);
    }
    this.notify();
  },

  // Generazione dati demo iniziali per mostrare subito le potenzialità dell'app
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
        dueDate: null, // Memo fluttuante (senza data)
        status: 'todo',
        description: 'Controllare scadenze F24 e invio fatture elettroniche.'
      },
      {
        id: 'task_demo_2',
        title: 'Preparare la presentazione del cliente',
        urgency: 'high',
        category: 'lavoro',
        dueDate: todayStr, // Programmata per oggi
        status: 'in_progress',
        description: 'Includere grafici di performance e slide introduttive.'
      },
      {
        id: 'task_demo_3',
        title: 'Ordinare nuovo materiale di studio',
        urgency: 'medium',
        category: 'studio',
        dueDate: null, // Memo fluttuante
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

    this.saveToStorage();
  },

  // Operazioni Eventi
  addEvent(eventData) {
    const newEvent = {
      id: 'evt_' + Date.now(),
      ...eventData
    };
    this.events.push(newEvent);
    this.saveToStorage();
    return newEvent;
  },

  updateEvent(id, eventData) {
    const idx = this.events.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.events[idx] = { ...this.events[idx], ...eventData };
      this.saveToStorage();
    }
  },

  deleteEvent(id) {
    this.events = this.events.filter(e => e.id !== id);
    this.saveToStorage();
  },

  // Operazioni Task / Memo
  addTask(taskData) {
    const newTask = {
      id: 'task_' + Date.now(),
      status: 'todo',
      ...taskData
    };
    this.tasks.push(newTask);
    this.saveToStorage();
    return newTask;
  },

  updateTask(id, taskData) {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx !== -1) {
      this.tasks[idx] = { ...this.tasks[idx], ...taskData };
      this.saveToStorage();
    }
  },

  deleteTask(id) {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.saveToStorage();
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

  // Helpers di filtraggio
  getFilteredTasks() {
    return this.tasks.filter(task => {
      // Filtro Tab (Sospesi / Tutte)
      if (this.sidebarTab === 'undated' && task.dueDate !== null && task.dueDate !== '') {
        return false;
      }
      // Filtro Urgenza
      if (this.filterUrgency !== 'all' && task.urgency !== this.filterUrgency) {
        return false;
      }
      // Filtro Categoria
      if (this.filterCategory !== 'all' && task.category !== this.filterCategory) {
        return false;
      }
      // Filtro Ricerca Testuale
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
