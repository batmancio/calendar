/**
 * Chronos Calendar Engine Module
 * Calcolo dei giorni del mese, rendering delle celle del calendario, gestione viste e drag&drop.
 */

import { AppState, formatDateKey } from './state.js';
import { openEventModal, openTaskModal, openEventDetailModal, openTaskDetailModal } from './modal.js';

const MONTH_NAMES_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

export function renderCalendar() {
  const currentMonthYearLabel = document.getElementById('currentMonthYearLabel');
  const calendarGrid = document.getElementById('calendarGrid');
  const agendaList = document.getElementById('agendaList');

  const viewMonthContainer = document.getElementById('calendarViewContainer');
  const viewAgendaContainer = document.getElementById('agendaViewContainer');

  const currDate = AppState.currentDate;
  const year = currDate.getFullYear();
  const month = currDate.getMonth();

  // Aggiorna etichetta mese/anno
  if (currentMonthYearLabel) {
    currentMonthYearLabel.textContent = `${MONTH_NAMES_IT[month]} ${year}`;
  }

  // Gestione visibilità Viste
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

  // Primo giorno del mese (0 = Domenica, 1 = Lunedì...)
  const firstDayObj = new Date(year, month, 1);
  let startingDayOfWeek = firstDayObj.getDay() - 1; // Convertiamo a Lunedì=0 ... Domenica=6
  if (startingDayOfWeek === -1) startingDayOfWeek = 6;

  // Numero di giorni nel mese corrente e precedente
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // Calcolo celle totali (35 o 42)
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
      // Giorni del mese precedente
      isOtherMonth = true;
      const prevDay = daysInPrevMonth - (startingDayOfWeek - 1 - i);
      displayDayNum = prevDay;
      const prevMonthDate = new Date(year, month - 1, prevDay);
      cellDateStr = formatDateKey(prevMonthDate);
    } else if (dayCounter <= daysInMonth) {
      // Giorni del mese corrente
      displayDayNum = dayCounter;
      const currMonthDate = new Date(year, month, dayCounter);
      cellDateStr = formatDateKey(currMonthDate);
      if (cellDateStr === todayStr) {
        cell.classList.add('today');
      }
      dayCounter++;
    } else {
      // Giorni del mese successivo
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

    // Header della cella
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

    // Contenitore Eventi & Task della cella
    const eventsContainer = document.createElement('div');
    eventsContainer.className = 'cell-events-container';

    // 1. Filtra Eventi per questa data
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
        openEventDetailModal(evt);
      });
      eventsContainer.appendChild(evtEl);
    });

    // 2. Filtra Task per questa data
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
        openTaskDetailModal(task);
      });
      eventsContainer.appendChild(taskEl);
    });

    cell.appendChild(eventsContainer);

    // Integrazione Drag & Drop per spostare Memo nel calendario
    setupCellDragAndDrop(cell, cellDateStr);

    container.appendChild(cell);
  }
}

// Drag & Drop per le celle del calendario
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

// Rendering Vista Agenda
function renderAgendaList(container) {
  if (!container) return;
  container.innerHTML = '';

  // Raccoglie tutti gli elementi con data ordinati cronologicamente
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
        itemCard.addEventListener('click', () => openEventDetailModal(evt));
      } else {
        const task = item.data;
        itemCard.innerHTML = `
          <div>
            <strong style="color: var(--text-main); ${task.status === 'completed' ? 'text-decoration: line-through; color: var(--text-dim);' : ''}">${escapeHtml(task.title)}</strong>
            <div style="font-size: 0.78rem; color: var(--text-muted);">Urgenza: ${task.urgency.toUpperCase()} | Stato: ${task.status}</div>
          </div>
          <span class="urgency-badge ${task.urgency}">${task.urgency}</span>
        `;
        itemCard.addEventListener('click', () => openTaskDetailModal(task));
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

function escapeHtml(str) {
  return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  }, 3000);
}
