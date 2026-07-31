/**
 * Chronos - Cycle Engine & Calculations Module
 * Gestisce i calcoli matematici del ciclo mestruale, la previsione delle fasi e le definizioni dei sintomi.
 */

const DEFAULT_CYCLE_SETTINGS = {
  enabled: false,
  lastPeriodStart: '', // YYYY-MM-DD
  avgCycleLength: 28,  // giorni (21-45)
  avgPeriodLength: 5,  // giorni (2-10)
  lutealPhaseLength: 14, // giorni (10-16)
  discreteNotifications: true,
  pinCode: ''
};

const CYCLE_PHASES = {
  menstrual: {
    key: 'menstrual',
    name: 'Mestruale',
    icon: '🩸',
    color: '#f43f5e',
    badgeClass: 'phase-menstrual',
    label: 'Fase Mestruale',
    tip: 'Riposo e rigenerazione. Mantieni una buona idratazione e rispetta i ritmi del tuo corpo.'
  },
  follicular: {
    key: 'follicular',
    name: 'Follicolare',
    icon: '🌱',
    color: '#10b981',
    badgeClass: 'phase-follicular',
    label: 'Fase Follicolare',
    tip: 'Gli estrogeni aumentano! È il momento ideale per pianificare progetti e fare attività fisica.'
  },
  ovulatory: {
    key: 'ovulatory',
    name: 'Ovulazione',
    icon: '🌸',
    color: '#f97316',
    badgeClass: 'phase-ovulatory',
    label: 'Ovulazione',
    tip: 'Picco di energia e vitalità. Massima fertilità.'
  },
  luteal: {
    key: 'luteal',
    name: 'Luteale / PMS',
    icon: '🌙',
    color: '#f59e0b',
    badgeClass: 'phase-luteal',
    label: 'Fase Luteale',
    tip: 'Il progesterone domina. Pratica il self-care, previeni lo stress e concediti momenti di relax.'
  }
};

const FLOW_LEVELS = [
  { id: 'none', label: 'Nessuno', icon: '⚪' },
  { id: 'spotting', label: 'Spotting', icon: '💧' },
  { id: 'light', label: 'Leggero', icon: '🩸' },
  { id: 'medium', label: 'Medio', icon: '🩸🩸' },
  { id: 'heavy', label: 'Abbondante', icon: '🩸🩸🩸' }
];

const SYMPTOMS_LIST = [
  { id: 'cramps', label: 'Crampi addominali', icon: '⚡' },
  { id: 'headache', label: 'Mal di testa', icon: '🤕' },
  { id: 'bloating', label: 'Gonfiore', icon: '🎈' },
  { id: 'fatigue', label: 'Stanchezza', icon: '😴' },
  { id: 'acne', label: 'Acne / Pelle sensibile', icon: '✨' },
  { id: 'breast', label: 'Seno dolorante', icon: '🌸' },
  { id: 'backache', label: 'Mal di schiena', icon: '🦴' },
  { id: 'mood_swings', label: 'Sbalzi d\'umore', icon: '🎭' },
  { id: 'nausea', label: 'Nausea', icon: '🤢' },
  { id: 'insomnia', label: 'Insonnia', icon: '🌙' }
];

const MOODS_LIST = [
  { id: 'happy', label: 'Felice', icon: '😊' },
  { id: 'calm', label: 'Serena', icon: '😌' },
  { id: 'energetic', label: 'Energica', icon: '⚡' },
  { id: 'tired', label: 'Stanca', icon: '😴' },
  { id: 'sad', label: 'Triste', icon: '😢' },
  { id: 'irritable', label: 'Irritabile', icon: '😤' },
  { id: 'anxious', label: 'Ansiosa', icon: '😰' }
];

function parseDateKey(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDateKey(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function diffDays(dateA, dateB) {
  const utc1 = Date.UTC(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
  const utc2 = Date.UTC(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());
  return Math.floor((utc1 - utc2) / (1000 * 60 * 60 * 24));
}

function calculateCycleState(targetDateInput, settings) {
  if (!settings || !settings.enabled || !settings.lastPeriodStart) {
    return {
      enabled: false,
      configured: false
    };
  }

  const targetDate = typeof targetDateInput === 'string' ? parseDateKey(targetDateInput) : targetDateInput;
  if (!targetDate || isNaN(targetDate.getTime())) {
    return { enabled: false, configured: false };
  }

  const cycleLen = Number(settings.avgCycleLength) || 28;
  const periodLen = Number(settings.avgPeriodLength) || 5;
  const lutealLen = Number(settings.lutealPhaseLength) || 14;

  const baseStart = parseDateKey(settings.lastPeriodStart);
  if (!baseStart) return { enabled: false, configured: false };

  const daysDiff = diffDays(targetDate, baseStart);

  let cycleNum = Math.floor(daysDiff / cycleLen);
  let currentCycleStart = new Date(baseStart);
  currentCycleStart.setDate(currentCycleStart.getDate() + (cycleNum * cycleLen));

  let dayOfCycle = diffDays(targetDate, currentCycleStart) + 1;

  while (dayOfCycle < 1) {
    cycleNum--;
    currentCycleStart = new Date(baseStart);
    currentCycleStart.setDate(currentCycleStart.getDate() + (cycleNum * cycleLen));
    dayOfCycle = diffDays(targetDate, currentCycleStart) + 1;
  }

  const ovulationDay = cycleLen - lutealLen;
  const fertileStart = Math.max(1, ovulationDay - 5);
  const fertileEnd = Math.min(cycleLen, ovulationDay + 1);

  let phase = CYCLE_PHASES.luteal;
  if (dayOfCycle <= periodLen) {
    phase = CYCLE_PHASES.menstrual;
  } else if (dayOfCycle >= fertileStart && dayOfCycle <= fertileEnd) {
    phase = CYCLE_PHASES.ovulatory;
  } else if (dayOfCycle < fertileStart) {
    phase = CYCLE_PHASES.follicular;
  } else {
    phase = CYCLE_PHASES.luteal;
  }

  const nextPeriodStart = new Date(currentCycleStart);

  // Se siamo oltre la durata attuale delle mestruazioni, il prossimo inizio ciclo è quello successivo
  nextPeriodStart.setDate(nextPeriodStart.getDate() + cycleLen);
  const daysUntilNextPeriod = diffDays(nextPeriodStart, targetDate);

  const nextOvulationDate = new Date(currentCycleStart);
  nextOvulationDate.setDate(nextOvulationDate.getDate() + (ovulationDay - 1));
  if (targetDate > nextOvulationDate) {
    nextOvulationDate.setDate(nextOvulationDate.getDate() + cycleLen);
  }
  const daysUntilOvulation = diffDays(nextOvulationDate, targetDate);

  return {
    enabled: true,
    configured: true,
    targetDateStr: formatDateKey(targetDate),
    dayOfCycle,
    cycleLength: cycleLen,
    periodLength: periodLen,
    phase,
    isPeriodDay: dayOfCycle <= periodLen,
    isOvulationDay: dayOfCycle === ovulationDay,
    isFertile: dayOfCycle >= fertileStart && dayOfCycle <= fertileEnd,
    daysUntilNextPeriod: Math.max(0, daysUntilNextPeriod),
    nextPeriodStartStr: formatDateKey(nextPeriodStart),
    nextOvulationStr: formatDateKey(nextOvulationDate),
    daysUntilOvulation: Math.max(0, daysUntilOvulation)
  };
}

function getCyclePredictionsForRange(startDateStr, endDateStr, settings) {
  if (!settings || !settings.enabled || !settings.lastPeriodStart) return {};

  const start = parseDateKey(startDateStr);
  const end = parseDateKey(endDateStr);
  if (!start || !end) return {};

  const map = {};
  const curr = new Date(start);

  while (curr <= end) {
    const key = formatDateKey(curr);
    const state = calculateCycleState(curr, settings);
    if (state.enabled) {
      map[key] = state;
    }
    curr.setDate(curr.getDate() + 1);
  }

  return map;
}

const ChronosCycle = {
  DEFAULT_CYCLE_SETTINGS,
  CYCLE_PHASES,
  FLOW_LEVELS,
  SYMPTOMS_LIST,
  MOODS_LIST,
  parseDateKey,
  formatDateKey,
  diffDays,
  calculateCycleState,
  getCyclePredictionsForRange
};

if (typeof window !== 'undefined') {
  window.ChronosCycle = ChronosCycle;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChronosCycle;
}
