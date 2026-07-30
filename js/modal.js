/**
 * Chronos Modals Engine
 * Gestione dei modali di creazione/modifica eventi e task/memo.
 */

import { AppState, formatDateKey } from './state.js';

export function initModals() {
  // Chiusura modali via pulsanti close o backdrop
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

  // Listener Form Evento
  const eventForm = document.getElementById('eventForm');
  if (eventForm) {
    eventForm.addEventListener('submit', handleEventSubmit);
  }

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

  // Listener Form Task/Memo
  const taskForm = document.getElementById('taskForm');
  if (taskForm) {
    taskForm.addEventListener('submit', handleTaskSubmit);
  }

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
}

export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
  }
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
  }
}

// Modal Evento - Nuovo / Modifica
export function openEventModal(initialData = {}) {
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

export function openEventDetailModal(evt) {
  openEventModal(evt);
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

// Modal Task / Memo - Nuovo / Modifica
export function openTaskModal(initialData = {}) {
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

export function openTaskDetailModal(task) {
  openTaskModal(task);
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
