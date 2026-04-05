// ─────────────────────────────────────────────────────────────────────────────
// Prabala Task Manager Demo — Renderer
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

// ── Demo credentials ─────────────────────────────────────────────────────────
const USERS = {
  admin: { password: 'admin123', displayName: 'Admin' },
  user:  { password: 'user123',  displayName: 'User'  },
};

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let tasks       = [];
let contacts    = [];
let taskIdSeq   = 1;
let contactIdSeq = 1;
let editingTaskId = null;
let activeFilter = 'all';

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.style.display = 'none';
  });
  const target = $(viewId);
  target.style.display = viewId === 'app-view' ? 'flex' : 'flex';
  target.classList.add('active');
}

function showContentView(viewId) {
  document.querySelectorAll('.content-view').forEach(v => {
    v.classList.remove('active');
    v.style.display = 'none';
  });
  $(viewId).style.display = 'flex';
  $(viewId).classList.add('active');

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.view === viewId) btn.classList.add('active');
  });
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.classList.add('hidden'), 200);
  }, 2200);
}

// ── Login ─────────────────────────────────────────────────────────────────────
$('login-btn').addEventListener('click', handleLogin);
$('password-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

function handleLogin() {
  const username = $('username-input').value.trim().toLowerCase();
  const password = $('password-input').value;
  const errEl    = $('login-error');

  if (!username || !password) {
    showError(errEl, 'Please enter your username and password.');
    return;
  }

  const user = USERS[username];
  if (!user || user.password !== password) {
    showError(errEl, 'Invalid username or password. Please try again.');
    $('password-input').value = '';
    $('password-input').focus();
    return;
  }

  errEl.classList.add('hidden');
  currentUser = { username, ...user };

  // Seed demo data for admin on first login
  if (username === 'admin' && tasks.length === 0) seedDemoData();

  // Update sidebar user info
  $('user-name').textContent    = currentUser.displayName;
  $('user-avatar').textContent  = currentUser.displayName[0].toUpperCase();
  $('display-name-input').value = currentUser.displayName;

  showView('app-view');
  showContentView('tasks-view');
  renderTasks();
  renderContacts();
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── Logout ────────────────────────────────────────────────────────────────────
$('logout-btn').addEventListener('click', () => {
  currentUser = null;
  $('username-input').value = '';
  $('password-input').value = '';
  $('login-error').classList.add('hidden');
  showView('login-view');
  showToast('Signed out successfully.');
});

// ── Navigation ────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    showContentView(btn.dataset.view);
    hideTaskForm();
    hideContactForm();
  });
});

// ── TASKS ─────────────────────────────────────────────────────────────────────
function seedDemoData() {
  tasks = [
    { id: taskIdSeq++, title: 'Review project proposal', priority: 'high',   dueDate: '2026-04-10', completed: false },
    { id: taskIdSeq++, title: 'Set up CI/CD pipeline',   priority: 'medium', dueDate: '2026-04-15', completed: false },
    { id: taskIdSeq++, title: 'Update documentation',    priority: 'low',    dueDate: '2026-04-20', completed: true  },
  ];
  contacts = [
    { id: contactIdSeq++, name: 'Alice Johnson', email: 'alice@example.com', phone: '+1 555-0101', department: 'engineering' },
    { id: contactIdSeq++, name: 'Bob Smith',     email: 'bob@example.com',   phone: '+1 555-0102', department: 'marketing' },
  ];
}

// Show / hide task form
$('add-task-btn').addEventListener('click', () => {
  editingTaskId = null;
  $('task-form-title').textContent = 'New Task';
  $('task-title-input').value = '';
  $('task-priority-select').value = 'medium';
  $('task-due-date').value = '';
  $('task-form-panel').classList.remove('hidden');
  $('task-title-input').focus();
  $('add-task-btn').style.display = 'none';
});

$('cancel-task-btn').addEventListener('click', hideTaskForm);

function hideTaskForm() {
  $('task-form-panel').classList.add('hidden');
  $('add-task-btn').style.display = '';
}

// Save task (new or edit)
$('save-task-btn').addEventListener('click', () => {
  const title = $('task-title-input').value.trim();
  if (!title) { $('task-title-input').focus(); return; }

  if (editingTaskId !== null) {
    const t = tasks.find(t => t.id === editingTaskId);
    if (t) {
      t.title    = title;
      t.priority = $('task-priority-select').value;
      t.dueDate  = $('task-due-date').value;
    }
    showToast('Task updated.');
  } else {
    tasks.push({
      id:        taskIdSeq++,
      title,
      priority:  $('task-priority-select').value,
      dueDate:   $('task-due-date').value,
      completed: false,
    });
    showToast('Task added.');
  }

  editingTaskId = null;
  hideTaskForm();
  renderTasks();
});

// Filter tabs
document.querySelectorAll('.filter-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderTasks();
  });
});

function renderTasks() {
  const list = $('task-list');
  let visible = tasks;
  if (activeFilter === 'active') visible = tasks.filter(t => !t.completed);
  if (activeFilter === 'done')   visible = tasks.filter(t =>  t.completed);

  $('task-count-label').textContent = `${tasks.length} task${tasks.length !== 1 ? 's' : ''} total`;

  if (visible.length === 0) {
    list.innerHTML = `<p class="empty-state" aria-label="No Tasks Message">No tasks here yet.</p>`;
    return;
  }

  list.innerHTML = visible.map(task => `
    <div class="task-item ${task.completed ? 'completed' : ''}"
         aria-label="Task: ${escHtml(task.title)}"
         data-task-id="${task.id}">
      <div class="task-checkbox ${task.completed ? 'checked' : ''}"
           aria-label="${task.completed ? 'Mark Incomplete' : 'Complete'} ${escHtml(task.title)}"
           role="button" tabindex="0"
           onclick="toggleTask(${task.id})">
        ${task.completed ? '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
      </div>
      <div class="task-body">
        <div class="task-title-text">${escHtml(task.title)}</div>
        <div class="task-meta">
          ${task.dueDate ? `Due: ${task.dueDate} · ` : ''}
          <span class="priority-badge priority-${task.priority}">${task.priority}</span>
        </div>
      </div>
      <div class="task-actions">
        <button class="icon-btn edit"
                aria-label="Edit ${escHtml(task.title)}"
                onclick="editTask(${task.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="icon-btn delete"
                aria-label="Delete ${escHtml(task.title)}"
                onclick="deleteTask(${task.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

function toggleTask(id) {
  const t = tasks.find(t => t.id === id);
  if (t) { t.completed = !t.completed; renderTasks(); }
}

function editTask(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  editingTaskId = id;
  $('task-form-title').textContent = 'Edit Task';
  $('task-title-input').value      = t.title;
  $('task-priority-select').value  = t.priority;
  $('task-due-date').value         = t.dueDate || '';
  $('task-form-panel').classList.remove('hidden');
  $('task-title-input').focus();
  $('add-task-btn').style.display = 'none';
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  renderTasks();
  showToast('Task deleted.');
}

// Make task actions globally accessible (called from inline onclick)
window.toggleTask = toggleTask;
window.editTask   = editTask;
window.deleteTask = deleteTask;

// ── CONTACTS ──────────────────────────────────────────────────────────────────
$('add-contact-btn').addEventListener('click', () => {
  $('contact-name-input').value  = '';
  $('contact-email-input').value = '';
  $('contact-phone-input').value = '';
  $('contact-dept-select').value = '';
  $('contact-form-panel').classList.remove('hidden');
  $('contact-name-input').focus();
  $('add-contact-btn').style.display = 'none';
});

$('cancel-contact-btn').addEventListener('click', hideContactForm);

function hideContactForm() {
  $('contact-form-panel').classList.add('hidden');
  $('add-contact-btn').style.display = '';
}

$('save-contact-btn').addEventListener('click', () => {
  const name = $('contact-name-input').value.trim();
  if (!name) { $('contact-name-input').focus(); return; }

  contacts.push({
    id:         contactIdSeq++,
    name,
    email:      $('contact-email-input').value.trim(),
    phone:      $('contact-phone-input').value.trim(),
    department: $('contact-dept-select').value,
  });

  hideContactForm();
  renderContacts();
  showToast('Contact added.');
});

function renderContacts() {
  const grid = $('contact-list');
  $('contact-count-label').textContent = `${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`;

  if (contacts.length === 0) {
    grid.innerHTML = `<p class="empty-state" aria-label="No Contacts Message">No contacts yet. Click "Add Contact" to add someone.</p>`;
    return;
  }

  grid.innerHTML = contacts.map(c => `
    <div class="contact-card" aria-label="Contact: ${escHtml(c.name)}" data-contact-id="${c.id}">
      <div class="contact-avatar">${escHtml(c.name[0].toUpperCase())}</div>
      <div class="contact-name">${escHtml(c.name)}</div>
      ${c.email ? `<div class="contact-email">${escHtml(c.email)}</div>` : ''}
      ${c.phone ? `<div class="contact-phone">${escHtml(c.phone)}</div>` : ''}
      ${c.department ? `<span class="contact-dept">${escHtml(c.department)}</span>` : ''}
      <div class="contact-card-actions">
        <button class="icon-btn delete"
                aria-label="Delete Contact ${escHtml(c.name)}"
                onclick="deleteContact(${c.id})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

function deleteContact(id) {
  contacts = contacts.filter(c => c.id !== id);
  renderContacts();
  showToast('Contact removed.');
}
window.deleteContact = deleteContact;

// ── SETTINGS ──────────────────────────────────────────────────────────────────
$('dark-mode-toggle').addEventListener('change', e => {
  document.documentElement.style.setProperty(
    '--bg',      e.target.checked ? '#0f172a' : '#f0f2f5');
  document.documentElement.style.setProperty(
    '--surface', e.target.checked ? '#1e293b' : '#ffffff');
  document.documentElement.style.setProperty(
    '--border',  e.target.checked ? '#334155' : '#e2e8f0');
  document.documentElement.style.setProperty(
    '--text',    e.target.checked ? '#f1f5f9' : '#1e293b');
});

$('save-settings-btn').addEventListener('click', () => {
  const displayName = $('display-name-input').value.trim();
  if (displayName && currentUser) {
    currentUser.displayName = displayName;
    $('user-name').textContent   = displayName;
    $('user-avatar').textContent = displayName[0].toUpperCase();
  }
  const msg = $('settings-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2500);
  showToast('Settings saved successfully.');
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
