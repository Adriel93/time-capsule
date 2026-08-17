const $ = id => document.getElementById(id);

const login = $('login');
const panel = $('panel');
const loginForm = $('loginForm');
const eventForm = $('eventForm');
const now = new Date();
const monthNames = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

let visibleMonth = new Date(now.getFullYear(), now.getMonth(), 1);
let selectedDay = now.getDate();
let selectedMonth = now.getMonth() + 1;
let adminRecords = [];
let selectedRequest = 0;

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Error al realizar la operación.');
  return data;
}

async function checkAuth() {
  try {
    const data = await api('/api/auth/status');
    login.hidden = data.authenticated;
    panel.hidden = !data.authenticated;
    if (data.authenticated) {
      resetForm();
      await refreshAll();
    }
  } catch (error) {
    $('loginMsg').textContent = error.message;
  }
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  $('loginMsg').textContent = '';
  try {
    await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('password').value })
    });
    $('password').value = '';
    await checkAuth();
  } catch (error) {
    $('loginMsg').textContent = error.message;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  await checkAuth();
});

$('previousMonth').addEventListener('click', () => changeMonth(-1));
$('nextMonth').addEventListener('click', () => changeMonth(1));
$('cancelEdit').addEventListener('click', resetForm);
$('clearForm').addEventListener('click', resetForm);
$('modalCloseIcon').addEventListener('click', closeViewModal);
$('modalCloseButton').addEventListener('click', closeViewModal);
$('viewModal').addEventListener('click', event => {
  if (event.target === $('viewModal')) closeViewModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('viewModal').hidden) closeViewModal();
});

$('calendar').addEventListener('click', event => {
  const button = event.target.closest('[data-day]');
  if (!button) return;

  selectedDay = Number(button.dataset.day);
  selectedMonth = visibleMonth.getMonth() + 1;
  if (!$('id').value) setFormDate(selectedDay, selectedMonth);
  renderCalendar();
  loadSelectedDay();
});

$('dayEvents').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = Number(button.dataset.id);
  if (button.dataset.action === 'view') viewItem(id);
  if (button.dataset.action === 'edit') editItem(id);
  if (button.dataset.action === 'delete') deleteItem(id);
});

eventForm.addEventListener('submit', async event => {
  event.preventDefault();
  const editingId = $('id').value;
  const submittedDay = Number($('dia').value);
  const submittedMonth = Number($('mes').value);
  setFormMessage('Guardando…');
  $('submitButton').disabled = true;

  const formData = new FormData();
  formData.append('fecha_dia', $('dia').value);
  formData.append('fecha_mes', $('mes').value);
  formData.append('fecha_anno', $('anno').value);
  formData.append('titulo', $('titulo').value);
  formData.append('resumen', $('resumen').value);
  if ($('imagen').files[0]) formData.append('imagen', $('imagen').files[0]);

  try {
    await api(editingId ? `/api/admin/efemerides/${editingId}` : '/api/admin/efemerides', {
      method: editingId ? 'PUT' : 'POST',
      body: formData
    });
    selectedDay = submittedDay;
    selectedMonth = submittedMonth;
    visibleMonth = new Date(visibleMonth.getFullYear(), submittedMonth - 1, 1);
    resetForm(false);
    setFormMessage(editingId ? 'Efeméride actualizada.' : 'Efeméride creada.', 'success');
    await refreshAll();
  } catch (error) {
    setFormMessage(error.message, 'error');
  } finally {
    $('submitButton').disabled = false;
  }
});

function changeMonth(offset) {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
  renderCalendar();
}

async function refreshAll() {
  try {
    const data = await api('/api/admin/efemerides');
    adminRecords = data.efemerides;
    renderCalendar();
    renderRecent();
    await loadSelectedDay();
  } catch (error) {
    $('dayEvents').innerHTML = `<p class="empty-state error">${escapeHtml(error.message)}</p>`;
  }
}

function renderCalendar() {
  const year = visibleMonth.getFullYear();
  const monthIndex = visibleMonth.getMonth();
  const month = monthIndex + 1;
  const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const eventCounts = new Map();

  adminRecords.forEach(item => {
    if (item.fecha_mes === month) {
      eventCounts.set(item.fecha_dia, (eventCounts.get(item.fecha_dia) || 0) + 1);
    }
  });

  $('calendarTitle').textContent = `${capitalize(monthNames[monthIndex])} ${year}`;
  const cells = Array.from({ length: firstWeekday }, () => '<span class="calendar-empty" aria-hidden="true"></span>');

  for (let day = 1; day <= daysInMonth; day += 1) {
    const count = eventCounts.get(day) || 0;
    const isSelected = day === selectedDay && month === selectedMonth;
    const isToday = day === now.getDate() && month === now.getMonth() + 1 && year === now.getFullYear();
    const classes = ['calendar-day'];
    if (isSelected) classes.push('is-selected');
    if (isToday) classes.push('is-today');
    if (count) classes.push('has-events');
    const eventLabel = count ? `, ${count} ${count === 1 ? 'efeméride' : 'efemérides'}` : '';

    cells.push(`
      <button type="button" class="${classes.join(' ')}" data-day="${day}"
        role="gridcell" aria-selected="${isSelected}" aria-label="${day} de ${monthNames[monthIndex]}${eventLabel}">
        <span>${day}</span>${count ? `<small>${count}</small>` : ''}
      </button>`);
  }

  $('calendar').innerHTML = cells.join('');
}

async function loadSelectedDay() {
  const requestId = ++selectedRequest;
  const day = selectedDay;
  const month = selectedMonth;
  $('selectedDateTitle').textContent = `${day} de ${monthNames[month - 1]}`;
  $('selectedCount').textContent = '';
  $('dayEvents').innerHTML = '<p class="empty-state">Cargando…</p>';

  try {
    const data = await api(`/api/efemerides/${month}/${day}`);
    if (requestId !== selectedRequest) return;
    $('selectedCount').textContent = String(data.total);
    $('dayEvents').innerHTML = data.efemerides.length
      ? data.efemerides.map(dayEventTemplate).join('')
      : '<p class="empty-state">No hay efemérides para este día.</p>';
  } catch (error) {
    if (requestId !== selectedRequest) return;
    $('dayEvents').innerHTML = `<p class="empty-state error">${escapeHtml(error.message)}</p>`;
  }
}

function dayEventTemplate(item) {
  const year = item.fecha_anno ? `<span class="event-year">${item.fecha_anno}</span>` : '';
  return `
    <article class="event-row">
      <div class="event-main">
        ${year}
        <h3>${escapeHtml(item.titulo)}</h3>
      </div>
      <div class="event-actions">
        <button type="button" class="small-button view" data-action="view" data-id="${item.id}" title="Ver" aria-label="Ver ${escapeAttribute(item.titulo)}">
          <span aria-hidden="true">◉</span><span>Ver</span>
        </button>
        <button type="button" class="small-button" data-action="edit" data-id="${item.id}" title="Editar" aria-label="Editar ${escapeAttribute(item.titulo)}">
          <span aria-hidden="true">✎</span><span>Editar</span>
        </button>
        <button type="button" class="small-button danger" data-action="delete" data-id="${item.id}" title="Eliminar" aria-label="Eliminar ${escapeAttribute(item.titulo)}">
          <span aria-hidden="true">⌫</span><span>Eliminar</span>
        </button>
      </div>
    </article>`;
}

function renderRecent() {
  const recent = [...adminRecords]
    .sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en))
    .slice(0, 10);

  $('recentEvents').innerHTML = recent.length
    ? recent.map(item => `
      <div class="recent-item">
        <span>${pad(item.fecha_dia)}/${pad(item.fecha_mes)}${item.fecha_anno ? ` · ${item.fecha_anno}` : ''}</span>
        <strong>${escapeHtml(item.titulo)}</strong>
      </div>`).join('')
    : '<p class="empty-state">Todavía no hay registros.</p>';
}

function viewItem(id) {
  const item = adminRecords.find(record => record.id === id);
  if (!item) return;

  $('modalDate').textContent = formatFullDate(item);
  $('modalTitle').textContent = item.titulo;
  $('modalSummary').textContent = item.resumen;
  $('modalImageContainer').innerHTML = item.tiene_imagen
    ? `<img src="/api/efemerides/${item.id}/imagen" alt="Imagen de ${escapeAttribute(item.titulo)}">`
    : '<p class="modal-no-image">Esta efeméride no tiene imagen.</p>';
  $('viewModal').hidden = false;
  document.body.classList.add('modal-open');
  $('modalCloseIcon').focus();
}

function closeViewModal() {
  $('viewModal').hidden = true;
  document.body.classList.remove('modal-open');
}

function editItem(id) {
  const item = adminRecords.find(record => record.id === id);
  if (!item) return;

  $('id').value = item.id;
  $('dia').value = item.fecha_dia;
  $('mes').value = item.fecha_mes;
  $('anno').value = item.fecha_anno || '';
  $('titulo').value = item.titulo;
  $('resumen').value = item.resumen;
  $('imagen').value = '';
  $('formTitle').textContent = 'Editar efeméride';
  $('submitButton').textContent = 'Actualizar';
  $('cancelEdit').hidden = false;
  $('clearForm').hidden = true;
  setFormMessage('La imagen actual se conservará si no seleccionas otra.');
  document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('titulo').focus({ preventScroll: true });
}

async function deleteItem(id) {
  const item = adminRecords.find(record => record.id === id);
  if (!item) return;
  if (!window.confirm(`¿Eliminar “${item.titulo}”? Esta acción no se puede deshacer.`)) return;

  try {
    await api(`/api/admin/efemerides/${id}`, { method: 'DELETE' });
    if (String(id) === $('id').value) resetForm();
    await refreshAll();
  } catch (error) {
    window.alert(error.message);
  }
}

function resetForm(clearMessage = true) {
  eventForm.reset();
  $('id').value = '';
  $('formTitle').textContent = 'Nueva efeméride';
  $('submitButton').textContent = 'Guardar';
  $('cancelEdit').hidden = true;
  $('clearForm').hidden = false;
  setFormDate(selectedDay, selectedMonth);
  if (clearMessage) setFormMessage('');
}

function setFormDate(day, month) {
  $('dia').value = day;
  $('mes').value = month;
}

function setFormMessage(message, className = '') {
  $('formMsg').className = `form-message ${className}`.trim();
  $('formMsg').textContent = message;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatFullDate(item) {
  const date = `${item.fecha_dia} de ${monthNames[item.fecha_mes - 1]}`;
  return item.fecha_anno ? `${date} de ${item.fecha_anno}` : date;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

checkAuth();
