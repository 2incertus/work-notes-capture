/* === Project Color System === */
const PROJECT_COLORS = [
  '#e07b6b', '#7bc47f', '#9b8ec4', '#d4a746',
  '#5ba4b5', '#e08abf', '#8bc4c1'
];

function projectColor(name) {
  if (!name) return null;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

/* === Greetings & Personality === */
const GREETINGS = [
  'What are we shipping today?',
  'Another day, another deploy.',
  'Brain dump incoming...',
  'Let\'s get this bread.',
  'Capture everything. Forget nothing.',
  'Your second brain is ready.',
  'Neurons firing. Standing by.',
  'Ready when you are, chief.',
];
const EMPTY_MESSAGES = [
  'Nothing here yet. Go make some waves.',
  'Clean slate. The world is your oyster.',
  'No notes captured. The void stares back.',
  'Eerily quiet. Too quiet.',
  'Tabula rasa. Start typing.',
];
const CAPTURE_MESSAGES = [
  'Captured!',
  'Got it.',
  'Locked in.',
  'Filed away.',
  'Noted.',
  'Brain updated.',
  'Saved to the matrix.',
  'Committed to memory.',
];

function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* === State === */
let allNotes = [];
const activeTags = new Set();
let activeProject = 'all';
let activeTag = 'all';
let searchQuery = '';
let _submitting = false;
let highlightedNoteId = null;

/* === DOM Refs === */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* === Tag Chips === */
$$('.tag-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const tag = chip.dataset.tag;
    if (activeTags.has(tag)) { activeTags.delete(tag); chip.classList.remove('active'); }
    else { activeTags.add(tag); chip.classList.add('active'); }
  });
});

/* === Submit Note === */
async function submitNote() {
  if (_submitting) return;
  const text = $('#noteText').value.trim();
  if (!text) return;
  _submitting = true;

  const btn = $('#sendBtn');
  btn.disabled = true;

  const meeting = $('#meetingInput').value.trim() || null;
  const project = $('#projectInput').value.trim() || null;
  const priority = $('#prioritySelect').value;
  const tags = [...activeTags];

  const optimisticNote = {
    id: Date.now(),
    content: text,
    tags,
    meeting,
    project,
    priority,
    status: 'pending',
    result: null,
    created_at: Date.now() / 1000,
    _optimistic: true,
  };
  allNotes.unshift(optimisticNote);
  renderNotes();

  $('#noteText').value = '';
  $('#meetingInput').value = '';
  $('#projectInput').value = '';
  $('#prioritySelect').value = 'low';
  activeTags.clear();
  $$('.tag-chip').forEach(c => c.classList.remove('active'));

  try {
    const resp = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, tags, meeting, project, priority }),
    });
    if (resp.ok) {
      flash(randomFrom(CAPTURE_MESSAGES), 'var(--green)');
      await loadNotes();
    } else {
      flash('Failed to save', 'var(--red)');
      allNotes = allNotes.filter(n => n.id !== optimisticNote.id);
      renderNotes();
    }
  } catch (e) {
    flash('Network error', 'var(--red)');
    allNotes = allNotes.filter(n => n.id !== optimisticNote.id);
    renderNotes();
  }

  btn.disabled = false;
  setTimeout(() => { _submitting = false; }, 500);
}

$('#sendBtn').addEventListener('click', submitNote);

/* === Flash Message === */
function flash(msg, color) {
  const el = $('#flash');
  el.textContent = msg;
  el.style.color = color;
  setTimeout(() => { el.textContent = ''; }, 2500);
}

/* === Time Formatting === */
function timeAgo(ts) {
  const diff = (Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

/* === Escape HTML === */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* === Search Highlighting === */
function highlight(text, query) {
  if (!query) return esc(text);
  const escaped = esc(text);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let result = escaped;
  for (const term of terms) {
    const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    result = result.replace(re, '<mark>$1</mark>');
  }
  return result;
}

/* === Filter Notes === */
function filteredNotes() {
  let notes = allNotes;

  if (activeProject !== 'all') {
    notes = notes.filter(n => n.project === activeProject);
  }

  if (activeTag !== 'all') {
    notes = notes.filter(n => n.tags.includes(activeTag));
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    const tagMatch = q.match(/^tag:(\S+)/);
    const projMatch = q.match(/^project:(\S+)/);
    const prioMatch = q.match(/^priority:(\S+)/);

    if (tagMatch) {
      notes = notes.filter(n => n.tags.some(t => t.toLowerCase().includes(tagMatch[1])));
    } else if (projMatch) {
      notes = notes.filter(n => n.project && n.project.toLowerCase().includes(projMatch[1]));
    } else if (prioMatch) {
      notes = notes.filter(n => n.priority.toLowerCase() === prioMatch[1]);
    } else {
      notes = notes.filter(n =>
        n.content.toLowerCase().includes(q) ||
        (n.meeting && n.meeting.toLowerCase().includes(q)) ||
        (n.project && n.project.toLowerCase().includes(q)) ||
        n.tags.some(t => t.toLowerCase().includes(q))
      );
    }
  }

  return notes;
}

/* === Render Notes === */
function renderNotes() {
  const notes = filteredNotes();
  const list = $('#notesList');

  if (notes.length === 0) {
    list.innerHTML = `<div class="empty-state">${searchQuery ? 'No notes match that search.' : randomFrom(EMPTY_MESSAGES)}</div>`;
    return;
  }

  const hlQuery = searchQuery.replace(/^(tag|project|priority):\S*\s*/, '');

  list.innerHTML = notes.map(n => {
    const color = projectColor(n.project);
    const borderStyle = color ? `border-left-color: ${color}` : '';
    const isOptimistic = n._optimistic ? ' optimistic' : '';

    // AI summary (always visible if processed)
    let summaryHtml = '';
    if (n.result) {
      const quips = ['AI thinks:', 'tl;dr --', 'The gist:', 'In short:', 'Brain says:'];
      const quip = quips[n.id % quips.length];
      let aiLine = '';
      if (n.result.summary) aiLine = esc(n.result.summary);

      const nuggets = [];
      if (n.result.tasks_created) nuggets.push(`${n.result.tasks_created} task${n.result.tasks_created > 1 ? 's' : ''} spawned`);
      if (n.result.knowledge_items) nuggets.push(`${n.result.knowledge_items} note${n.result.knowledge_items > 1 ? 's' : ''} filed`);
      if (n.result.entities?.length) nuggets.push(n.result.entities.slice(0, 4).map(esc).join(', '));

      summaryHtml = `<div class="note-ai">
        <span class="ai-prefix">${quip}</span>
        ${aiLine ? `<span class="ai-text">${aiLine}</span>` : ''}
        ${nuggets.length ? `<span class="ai-nuggets">${nuggets.join(' &middot; ')}</span>` : ''}
      </div>`;
    }

    let resultHtml = '';

    const contentHtml = hlQuery ? highlight(n.content, hlQuery) : esc(n.content);

    const md = [
      n.content,
      '',
      n.meeting ? `Meeting: ${n.meeting}` : '',
      n.project ? `Project: ${n.project}` : '',
      n.priority !== 'low' ? `Priority: ${n.priority}` : '',
      n.tags.length ? `Tags: ${n.tags.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const highlightClass = highlightedNoteId === n.id ? ' highlighted' : '';

    return `
      <div class="note-card${isOptimistic}${highlightClass}" data-id="${n.id}" style="${borderStyle}" onclick="toggleExpand(this)">
        <div class="note-content">${contentHtml}</div>
        ${summaryHtml}
        <div class="note-meta">
          <span>${timeAgo(n.created_at)}</span>
          <span class="status-${n.status}">${n.status}</span>
          ${n.meeting ? `<span class="badge badge-meeting">${esc(n.meeting)}</span>` : ''}
          ${n.project ? `<span class="badge badge-project" style="background:${color}">${esc(n.project)}</span>` : ''}
          ${n.tags.map(t => `<span class="badge badge-tag">${esc(t)}</span>`).join('')}
        </div>
        ${resultHtml}
        <div class="note-actions">
          <div class="note-actions-left">
            <button class="copy-btn" onclick="event.stopPropagation(); copyText(this, '${btoa(encodeURIComponent(n.content))}')">Copy</button>
            <button class="copy-btn" onclick="event.stopPropagation(); copyText(this, '${btoa(encodeURIComponent(md))}')">Copy MD</button>
          </div>
          <div class="note-actions-right">
            <button class="icon-btn edit-btn" onclick="event.stopPropagation(); openEditModal(${n.id})" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="icon-btn delete-btn" onclick="event.stopPropagation(); deleteNote(${n.id})" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* === Expand / Collapse Note Cards === */
function toggleExpand(card) {
  card.classList.toggle('expanded');
}

/* === Copy to Clipboard === */
async function copyText(btn, encoded) {
  const text = decodeURIComponent(atob(encoded));
  await navigator.clipboard.writeText(text);
  const origLabel = btn.textContent;
  btn.classList.add('copied');
  btn.textContent = 'Copied!';
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.textContent = origLabel;
  }, 1500);
}

/* === Project Tabs === */
/* === Tag Colors === */
const TAG_COLORS = {
  'meeting': '#5ba4b5',
  'action-item': '#e2a846',
  'decision': '#9b8ec4',
  'idea': '#7bc47f',
  'blocker': '#e07b6b',
  'status': '#8bc4c1',
};
function tagColor(tag) {
  return TAG_COLORS[tag] || '#888';
}

function renderFilterTabs() {
  // Projects
  const projects = [...new Set(allNotes.map(n => n.project).filter(Boolean))].sort();
  const projTabs = $('#projectTabs');

  const allProjTab = `<button class="filter-tab${activeProject === 'all' ? ' active' : ''}" onclick="setProject('all')">All</button>`;
  const projHtml = projects.map(p => {
    const color = projectColor(p);
    const isActive = activeProject === p ? ' active' : '';
    return `<button class="filter-tab${isActive}" data-project="${esc(p)}" onclick="setProject(this.dataset.project)" style="${isActive ? `border-bottom-color: ${color}` : ''}">
      <span class="filter-dot" style="background:${color}"></span>${esc(p)}
    </button>`;
  }).join('');
  projTabs.innerHTML = allProjTab + projHtml;

  // Tags
  const tags = [...new Set(allNotes.flatMap(n => n.tags))].sort();
  const tagTabsEl = $('#tagTabs');

  if (tags.length === 0) {
    tagTabsEl.innerHTML = '';
    return;
  }

  const tagHtml = tags.map(t => {
    const color = tagColor(t);
    const isActive = activeTag === t ? ' active' : '';
    return `<button class="filter-tab${isActive}" data-tag="${esc(t)}" onclick="setTag(this.dataset.tag)" style="${isActive ? `border-bottom-color: ${color}` : ''}">
      <span class="filter-dot" style="background:${color}"></span>${esc(t)}
    </button>`;
  }).join('');
  tagTabsEl.innerHTML = tagHtml;
}

function setProject(project) {
  activeProject = project;
  renderFilterTabs();
  renderNotes();
}

function setTag(tag) {
  activeTag = activeTag === tag ? 'all' : tag;
  renderFilterTabs();
  renderNotes();
}

/* === Stats Strip === */
function renderStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime() / 1000;

  const todayNotes = allNotes.filter(n => n.created_at >= todayTs);
  const pending = allNotes.filter(n => n.status === 'pending');
  const totalTasks = allNotes.reduce((sum, n) => sum + (n.result?.tasks_created || 0), 0);

  $('#statToday').textContent = `${todayNotes.length} today`;
  $('#statTasks').textContent = `${totalTasks} tasks`;
  $('#statPending').textContent = `${pending.length} pending`;
}

/* === Load Notes from API === */
async function loadNotes() {
  try {
    const resp = await fetch('/api/notes?limit=50');
    const data = await resp.json();
    allNotes = data.notes;
    renderFilterTabs();
    renderStats();
    renderNotes();
    renderDashboard();
  } catch (e) {
    console.error('Failed to load notes', e);
  }
}

/* === Tasks Panel === */
const tasksToggle = $('#tasksToggle');
const tasksContent = $('#tasksContent');
let allTasks = [];
let tasksLoaded = false;

// Auto-open on load
tasksToggle.classList.add('open');
tasksContent.classList.add('open');

tasksToggle.addEventListener('click', () => {
  tasksToggle.classList.toggle('open');
  tasksContent.classList.toggle('open');
});

async function loadTasks() {
  try {
    const resp = await fetch('/api/tasks');
    const data = await resp.json();
    if (data.error) {
      tasksContent.innerHTML = '<div class="tasks-empty">Vikunja is being shy right now.</div>';
      return;
    }
    allTasks = data.tasks;
    tasksLoaded = true;
    renderTasks();
  } catch (e) {
    tasksContent.innerHTML = '<div class="tasks-empty">Failed to load tasks</div>';
  }
}

function formatDueDate(due) {
  if (!due || due.startsWith('0001')) return null;
  const d = new Date(due);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.floor((d - now) / 86400000);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diff < 0) return { text: `${dateStr} (overdue)`, overdue: true };
  if (diff === 0) return { text: 'Today', overdue: false };
  if (diff === 1) return { text: 'Tomorrow', overdue: false };
  return { text: dateStr, overdue: false };
}

function renderTasks() {
  const openTasks = allTasks.filter(t => !t.done);
  const recentDone = allTasks.filter(t => t.done).slice(0, 3);
  const tasks = [...openTasks, ...recentDone];

  $('#tasksCount').textContent = `${openTasks.length} open`;

  if (tasks.length === 0) {
    tasksContent.innerHTML = '<div class="tasks-empty">All clear. Nothing to do. (Suspicious.)</div>';
    return;
  }

  tasksContent.innerHTML = tasks.map(t => {
    const color = projectColor(t.project);
    const due = formatDueDate(t.due_date);
    const doneClass = t.done ? ' done' : '';
    return `
      <div class="task-item${doneClass}" data-task-id="${t.id}">
        <button class="task-check${t.done ? ' done' : ''}" onclick="event.stopPropagation(); toggleTaskDone(${t.id}, ${!t.done})"></button>
        <div class="task-info" onclick="focusNoteForTask('${btoa(encodeURIComponent(t.title))}')">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            ${t.project ? `<span class="task-project-badge" style="background:${color}">${esc(t.project)}</span>` : ''}
            ${due ? `<span class="task-due${due.overdue ? ' overdue' : ''}">${due.text}</span>` : ''}
            ${t.labels.map(l => `<span>${esc(l)}</span>`).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleTaskDone(taskId, done) {
  // Optimistic UI
  const item = document.querySelector(`.task-item[data-task-id="${taskId}"]`);
  const check = item?.querySelector('.task-check');
  if (done) {
    item?.classList.add('done');
    check?.classList.add('done');
  } else {
    item?.classList.remove('done');
    check?.classList.remove('done');
  }

  try {
    await fetch(`/api/tasks/${taskId}/done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    });
    // Reload to get fresh state
    await loadTasks();
  } catch (e) {
    console.error('Failed to toggle task', e);
    // Revert on failure
    if (!done) {
      item?.classList.add('done');
      check?.classList.add('done');
    } else {
      item?.classList.remove('done');
      check?.classList.remove('done');
    }
  }
}

// Load tasks on init and refresh periodically
loadTasks();
setInterval(loadTasks, 60000);

/* === Daily Brief === */
const briefToggle = $('#briefToggle');
const briefContent = $('#briefContent');
let briefLoaded = false;

briefToggle.addEventListener('click', async () => {
  briefToggle.classList.toggle('open');
  briefContent.classList.toggle('open');

  if (!briefLoaded && briefContent.classList.contains('open')) {
    briefContent.innerHTML = '<p style="color:var(--text-dim)">Summoning the oracle...</p>';
    try {
      const resp = await fetch('/api/brief');
      const data = await resp.json();
      if (data.error) {
        briefContent.innerHTML = '<p class="brief-error">Brief unavailable</p>';
      } else {
        const brief = data.brief || data;
        let html = '';
        if (brief.summary) html += `<h4>Summary</h4><p>${esc(brief.summary)}</p>`;
        if (brief.decisions?.length) html += `<h4>Decisions</h4><ul>${brief.decisions.map(d => `<li>${esc(d)}</li>`).join('')}</ul>`;
        if (brief.tomorrow_priorities?.length) html += `<h4>Priorities</h4><ul>${brief.tomorrow_priorities.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;
        if (brief.stalled?.length) html += `<h4>Stalled</h4><ul>${brief.stalled.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
        if (brief.patterns?.length) {
          const patterns = Array.isArray(brief.patterns) ? brief.patterns : [brief.patterns];
          html += `<h4>Patterns</h4><ul>${patterns.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;
        }
        if (brief.stats) {
          html += `<div class="brief-stats">`;
          if (brief.stats.notes_captured != null) html += `<span>${brief.stats.notes_captured} notes</span>`;
          if (brief.stats.tasks_created != null) html += `<span>${brief.stats.tasks_created} tasks</span>`;
          if (brief.stats.knowledge_items != null) html += `<span>${brief.stats.knowledge_items} knowledge</span>`;
          html += `</div>`;
        }
        briefContent.innerHTML = html || '<p class="brief-error">No brief data for today</p>';
      }
      briefLoaded = true;
    } catch (e) {
      briefContent.innerHTML = '<p class="brief-error">The oracle is sleeping. Try again later.</p>';
    }
  }
});

/* === Search === */
const searchInput = $('#searchInput');
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  renderNotes();
});

/* === Keyboard Shortcuts === */
document.addEventListener('keydown', (e) => {
  const target = e.target;
  const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    submitNote();
    return;
  }

  if (inInput) return;

  if (e.key === '/') {
    e.preventDefault();
    searchInput.focus();
    return;
  }

  if (e.key === 'n') {
    e.preventDefault();
    $('#noteText').focus();
    return;
  }

  if (e.key === '?') {
    e.preventDefault();
    $('#shortcutOverlay').classList.toggle('visible');
    return;
  }

  if (e.key === 'Escape') {
    if ($('#editOverlay').classList.contains('visible')) {
      closeEditModal();
    } else if ($('#shortcutOverlay').classList.contains('visible')) {
      $('#shortcutOverlay').classList.remove('visible');
    } else if (searchQuery) {
      searchInput.value = '';
      searchQuery = '';
      renderNotes();
    } else {
      $$('.note-card.expanded').forEach(c => c.classList.remove('expanded'));
    }
    return;
  }
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    searchQuery = '';
    searchInput.blur();
    renderNotes();
  }
});

$('#shortcutOverlay').addEventListener('click', (e) => {
  if (e.target === $('#shortcutOverlay')) {
    $('#shortcutOverlay').classList.remove('visible');
  }
});

$('#editOverlay').addEventListener('click', (e) => {
  if (e.target === $('#editOverlay')) {
    closeEditModal();
  }
});

/* === Task-to-Note Linking === */
function focusNoteForTask(encodedTitle) {
  const title = decodeURIComponent(atob(encodedTitle)).toLowerCase();
  // Find note whose result created a task with this title, or whose content mentions it
  const match = allNotes.find(n =>
    (n.result?.summary && n.result.summary.toLowerCase().includes(title.substring(0, 30))) ||
    n.content.toLowerCase().includes(title.substring(0, 30))
  );
  if (match) {
    highlightedNoteId = match.id;
    // Clear filters to show the note
    activeProject = 'all';
    activeTag = 'all';
    searchQuery = '';
    $('#searchInput').value = '';
    renderFilterTabs();
    renderNotes();
    // Scroll to and expand it
    const card = document.querySelector(`.note-card[data-id="${match.id}"]`);
    if (card) {
      card.classList.add('expanded');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Remove highlight after a few seconds
      setTimeout(() => { highlightedNoteId = null; card.classList.remove('highlighted'); }, 3000);
    }
  } else {
    // No linked note found -- search for the task title
    searchQuery = title.substring(0, 40);
    $('#searchInput').value = searchQuery;
    renderNotes();
  }
}

/* === Delete Note === */
async function deleteNote(id) {
  if (!confirm('Delete this note? This cannot be undone.')) return;
  // Optimistic removal
  const idx = allNotes.findIndex(n => n.id === id);
  const removed = idx >= 0 ? allNotes.splice(idx, 1)[0] : null;
  renderNotes();
  renderStats();

  try {
    const resp = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    if (resp.ok) {
      flash('Gone forever.', 'var(--red)');
    } else {
      // Revert
      if (removed) { allNotes.splice(idx, 0, removed); renderNotes(); }
      flash('Delete failed', 'var(--red)');
    }
  } catch (e) {
    if (removed) { allNotes.splice(idx, 0, removed); renderNotes(); }
    flash('Network error', 'var(--red)');
  }
}

/* === Edit Note Modal === */
let editingNoteId = null;

function openEditModal(id) {
  const note = allNotes.find(n => n.id === id);
  if (!note) return;
  editingNoteId = id;

  $('#editContent').value = note.content;
  $('#editMeeting').value = note.meeting || '';
  $('#editProject').value = note.project || '';
  $('#editPriority').value = note.priority || 'low';

  // Set tag chips
  $$('.edit-tag-chip').forEach(chip => {
    if (note.tags.includes(chip.dataset.tag)) chip.classList.add('active');
    else chip.classList.remove('active');
  });

  $('#editOverlay').classList.add('visible');
  $('#editContent').focus();
}

function closeEditModal() {
  editingNoteId = null;
  $('#editOverlay').classList.remove('visible');
}

async function saveEdit() {
  if (!editingNoteId) return;

  const editTags = [...$$('.edit-tag-chip.active')].map(c => c.dataset.tag);
  const body = {
    content: $('#editContent').value.trim(),
    meeting: $('#editMeeting').value.trim() || null,
    project: $('#editProject').value.trim() || null,
    priority: $('#editPriority').value,
    tags: editTags,
  };

  if (!body.content) return;

  try {
    const resp = await fetch(`/api/notes/${editingNoteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      // Update local state
      const note = allNotes.find(n => n.id === editingNoteId);
      if (note) {
        note.content = body.content;
        note.meeting = body.meeting;
        note.project = body.project;
        note.priority = body.priority;
        note.tags = editTags;
      }
      closeEditModal();
      renderFilterTabs();
      renderNotes();
      flash('Updated.', 'var(--green)');
    } else {
      flash('Save failed', 'var(--red)');
    }
  } catch (e) {
    flash('Network error', 'var(--red)');
  }
}

// Wire up edit modal events after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Already loaded, but these selectors need the modal HTML
});

/* === Mini Dashboard === */
let dashSlide = 0;
const DASH_VIEWS = ['activity', 'projects', 'tags'];

function renderDashboard() {
  const canvas = $('#dashCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.parentElement.clientWidth - 24;
  const h = canvas.height = 80;
  ctx.clearRect(0, 0, w, h);

  const view = DASH_VIEWS[dashSlide % DASH_VIEWS.length];

  // Update label
  const labels = { activity: 'Activity (7d)', projects: 'By Project', tags: 'By Tag' };
  const label = $('#dashLabel');
  if (label) label.textContent = labels[view];

  if (view === 'activity') {
    // Bar chart: notes per day for last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
      const start = d.getTime() / 1000;
      const end = start + 86400;
      days.push({ label: d.toLocaleDateString('en-US', { weekday: 'short' })[0], count: allNotes.filter(n => n.created_at >= start && n.created_at < end).length });
    }
    const max = Math.max(1, ...days.map(d => d.count));
    const barW = Math.floor((w - 16) / 7) - 4;
    days.forEach((d, i) => {
      const barH = Math.max(2, (d.count / max) * (h - 22));
      const x = 8 + i * (barW + 4);
      const y = h - 14 - barH;
      ctx.fillStyle = d.count > 0 ? '#e2a846' : 'rgba(228,228,234,0.1)';
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(228,228,234,0.4)';
      ctx.font = '9px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(d.label, x + barW/2, h - 2);
    });
  } else if (view === 'projects') {
    // Horizontal bars by project
    const counts = {};
    allNotes.forEach(n => { if (n.project) counts[n.project] = (counts[n.project] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 5);
    if (sorted.length === 0) { ctx.fillStyle = 'rgba(228,228,234,0.3)'; ctx.font = '11px JetBrains Mono'; ctx.fillText('No project data', w/2, h/2); return; }
    const max = sorted[0][1];
    const rowH = Math.min(14, (h - 4) / sorted.length);
    sorted.forEach(([name, count], i) => {
      const barW2 = Math.max(4, (count / max) * (w - 90));
      const y = 2 + i * rowH;
      ctx.fillStyle = projectColor(name);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.roundRect(80, y, barW2, rowH - 3, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(228,228,234,0.6)';
      ctx.font = '10px Inter';
      ctx.textAlign = 'right';
      ctx.fillText(name.length > 10 ? name.slice(0,10) + '..' : name, 74, y + rowH - 5);
      ctx.fillStyle = 'rgba(228,228,234,0.4)';
      ctx.textAlign = 'left';
      ctx.fillText(count, 80 + barW2 + 4, y + rowH - 5);
    });
  } else if (view === 'tags') {
    // Dot grid by tag
    const counts = {};
    allNotes.forEach(n => n.tags.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 6);
    if (sorted.length === 0) { ctx.fillStyle = 'rgba(228,228,234,0.3)'; ctx.font = '11px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillText('No tag data', w/2, h/2); return; }
    const max = Math.max(1, ...sorted.map(s => s[1]));
    const cols = Math.min(3, sorted.length);
    const cellW = (w - 16) / cols;
    const cellH = sorted.length > 3 ? (h - 4) / 2 : h - 4;
    sorted.forEach(([tag, count], i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = 8 + col * cellW + cellW/2;
      const cy = 4 + row * cellH + cellH/2 - 4;
      const r = Math.max(6, (count / max) * 18);
      ctx.fillStyle = tagColor(tag);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(228,228,234,0.5)';
      ctx.font = '9px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(tag.length > 8 ? tag.slice(0,8) + '..' : tag, cx, cy + r + 10);
    });
  }
}

function cycleDashboard() {
  dashSlide = (dashSlide + 1) % DASH_VIEWS.length;
  renderDashboard();
}

/* === Init === */
// Set random greeting as placeholder
$('#noteText').placeholder = randomFrom(GREETINGS) + '\n\nDump it here. AI handles the rest.';

// Greeting in logo area
const hour = new Date().getHours();
const timeEmoji = hour < 12 ? '\u2600' : hour < 17 ? '\u26A1' : '\u263E';
$('.logo').textContent = `Work Notes ${timeEmoji}`;

loadNotes();
setInterval(loadNotes, 30000);

// Dashboard renders on first load (click to cycle, no auto-rotate)
setTimeout(renderDashboard, 500);
