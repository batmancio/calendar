/**
 * Chronos Task & Memo Module
 * Gestione del rendering delle task nella sidebar, aggiornamento conteggi urgenza e interazioni drag&drop.
 */

import { AppState } from './state.js';
import { openTaskDetailModal } from './modal.js';

export function renderTasks() {
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

  // Ordina per urgenza (Critical > High > Medium > Low) e poi per completamento
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

    // Inizio Drag
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });

    // Checkbox completamento
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

    // Event listener per checkbox
    const checkbox = card.querySelector('.task-checkbox');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      AppState.toggleTaskStatus(task.id);
    });

    // Event listener per apertura modale dettaglio/modifica
    card.addEventListener('click', () => {
      openTaskDetailModal(task);
    });

    taskListEl.appendChild(card);
  });
}

function isOverdue(task) {
  if (!task.dueDate || task.status === 'completed') return false;
  const todayStr = formatDateKey(new Date());
  return task.dueDate < todayStr;
}

function formatDateKey(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
