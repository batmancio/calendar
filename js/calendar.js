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

  const todayBtn = document.getElementById('todayBtn');
  if (todayBtn) {
    const now = new Date();
    const todayDay = now.getDate();
    const todayMonthName = MONTH_NAMES_IT[now.getMonth()];
    todayBtn.textContent = `${todayDay} ${todayMonthName}`;
    todayBtn.title = `Torna a Oggi (${todayDay} ${todayMonthName})`;
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
    addBtn.title = `Aggiungi evento per il ${formatDateShortItalian(cellDateStr)}`;
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

    // 1. Filtra Eventi per questa data (inclusi eventi multi-giorno)
    const dayEvents = AppState.events.filter(e => {
      const eventStart = e.date;
      const eventEnd = e.dateEnd || e.date;
      if (cellDateStr < eventStart || cellDateStr > eventEnd) return false;

      if (AppState.filterCategory !== 'all' && e.category !== AppState.filterCategory) return false;
      if (AppState.searchQuery.trim()) {
        const q = AppState.searchQuery.toLowerCase();
        return e.title.toLowerCase().includes(q) || (e.description && e.description.toLowerCase().includes(q));
      }
      return true;
    });

    dayEvents.forEach(evt => {
      const evtEl = document.createElement('div');
      const info = getMultiDayInfo(evt, cellDateStr, i);
      const catClass = evt.category ? `cat-${evt.category}` : 'cat-lavoro';
      evtEl.className = `cell-item event-item ${catClass} ${info.classes}`;
      evtEl.dataset.eventId = evt.id;

      if (info.isMultiDay) {
        if (info.isFirstDay) {
          evtEl.innerHTML = `<span class="multiday-label-start"><span class="badge-text-start">Inizio: </span><span class="badge-icon-start">▶ </span>${escapeHtml(evt.title)}</span>`;
        } else if (info.isRowStart && !info.isFirstDay) {
          evtEl.innerHTML = `<span class="multiday-label-cont"><span class="multi-day-arrow">◀ </span>${escapeHtml(evt.title)}</span>`;
        } else if (info.isLastDay) {
          evtEl.innerHTML = `<span class="multiday-label-end"><span class="badge-text-end">Fine: </span><span class="badge-icon-end">🏁 </span>${escapeHtml(evt.title)}</span>`;
        } else {
          evtEl.innerHTML = `<span class="multiday-bar-clean"></span>`;
        }
      } else {
        const timeStr = evt.timeStart ? formatTime24h(evt.timeStart) : '';
        const timeDisplay = timeStr ? `<span class="time">${timeStr}</span> ` : '';
        evtEl.innerHTML = `${timeDisplay}${escapeHtml(evt.title)}`;
      }

      // Hover / Touch sync highlight per tutti i giorni dello stesso evento
      evtEl.addEventListener('mouseenter', () => highlightEventSync(evt.id, true));
      evtEl.addEventListener('mouseleave', () => highlightEventSync(evt.id, false));

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
      showToast(`Task programmata per il ${formatDateShortItalian(dateStr)}`, 'success');
    }
  });
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

// Rendering Vista Agenda
function renderAgendaList(container) {
  if (!container) return;
  container.innerHTML = '';

  // Raccoglie tutti gli elementi con data ordinati cronologicamente
  const itemsByDate = {};

  AppState.events.forEach(evt => {
    if (AppState.filterCategory && AppState.filterCategory !== 'all' && evt.category !== AppState.filterCategory) return;
    if (AppState.searchQuery && AppState.searchQuery.trim()) {
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
      if (AppState.filterCategory && AppState.filterCategory !== 'all' && task.category !== AppState.filterCategory) return;
      if (AppState.filterUrgency && AppState.filterUrgency !== 'all' && task.urgency !== AppState.filterUrgency) return;
      if (AppState.searchQuery && AppState.searchQuery.trim()) {
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
        const md = item.multiDay;

        let timeFormatted = 'Tutto il giorno';
        if (md && md.isMultiDay) {
          if (md.isFirstDay) {
            timeFormatted = evt.timeStart ? `Dalle ${formatTime24h(evt.timeStart)} (Inizio)` : 'Giorno d\'inizio';
          } else if (md.isLastDay) {
            timeFormatted = evt.timeEnd ? `Fino alle ${formatTime24h(evt.timeEnd)} (Fine)` : 'Giorno di fine';
          } else {
            timeFormatted = 'Tutto il giorno';
          }
        } else {
          timeFormatted = evt.timeStart ? (formatTime24h(evt.timeStart) + (evt.timeEnd ? ' - ' + formatTime24h(evt.timeEnd) : '')) : 'Tutto il giorno';
        }

        const multiDayBadge = (md && md.isMultiDay) ? `<span style="font-size: 0.7rem; background: rgba(99,102,241,0.15); color: var(--accent-primary, #6366f1); padding: 2px 6px; border-radius: 4px; margin-left: 6px; font-weight: 600;">Giorno ${md.dayIndex}/${md.totalDays}</span>` : '';

        itemCard.innerHTML = `
          <div>
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
              <strong style="color: var(--text-main);">${escapeHtml(evt.title)}</strong>
              ${multiDayBadge}
            </div>
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top:2px;">${timeFormatted} | Categoria: ${evt.category}</div>
          </div>
          <span class="urgency-badge" style="background: rgba(99,102,241,0.2); color: var(--accent-primary);">Evento</span>
        `;
        itemCard.addEventListener('click', () => openEventDetailModal ? openEventDetailModal(evt) : openEventModal(evt));
      } else {
        const task = item.data;
        itemCard.innerHTML = `
          <div>
            <strong style="color: var(--text-main); ${task.status === 'completed' ? 'text-decoration: line-through; color: var(--text-dim);' : ''}">${escapeHtml(task.title)}</strong>
            <div style="font-size: 0.78rem; color: var(--text-muted);">Urgenza: ${task.urgency.toUpperCase()} | Stato: ${task.status}</div>
          </div>
          <span class="urgency-badge ${task.urgency}">${task.urgency}</span>
        `;
        itemCard.addEventListener('click', () => openTaskDetailModal ? openTaskDetailModal(task) : openTaskModal(task));
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

function formatDateShortItalian(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatTime24h(timeStr) {
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

function escapeHtml(str) {
  return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
