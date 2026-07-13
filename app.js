// ===== PIN Lock =====
const PIN_HASH = '1028';
const PIN_STORAGE_KEY = 'detox_digest_pin_ok';

function checkPin() {
  const saved = localStorage.getItem(PIN_STORAGE_KEY);
  if (saved === PIN_HASH) {
    unlockApp();
    return;
  }
  document.getElementById('pinLock').classList.remove('hidden');
}

function unlockApp() {
  document.getElementById('pinLock').classList.add('hidden');
  document.getElementById('appContainer').classList.remove('hidden');
  initApp();
}

document.getElementById('pinSubmit').addEventListener('click', attemptUnlock);
document.getElementById('pinInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptUnlock();
});

function attemptUnlock() {
  const input = document.getElementById('pinInput').value;
  const errorEl = document.getElementById('pinError');
  if (input === PIN_HASH) {
    localStorage.setItem(PIN_STORAGE_KEY, PIN_HASH);
    errorEl.classList.add('hidden');
    unlockApp();
  } else {
    errorEl.classList.remove('hidden');
    document.getElementById('pinInput').value = '';
    document.getElementById('pinInput').focus();
    // Shake animation
    const group = document.querySelector('.pin-input-group');
    group.classList.add('shake');
    setTimeout(() => group.classList.remove('shake'), 500);
  }
}

// ===== State =====
let allArticles = [];
let sitesConfig = [];
let currentSite = 'all';
let digestMode = false;
let autoRefreshTimer = null;
let isLoading = false;
let currentView = 'news';
let tasks = [];

// ===== Task Storage =====
const TASKS_STORAGE_KEY = 'detox_digest_tasks';

function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    tasks = raw ? JSON.parse(raw) : [];
  } catch {
    tasks = [];
  }
}

function saveTasks() {
  localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
}

// ===== Init App (called after PIN unlock) =====
function initApp() {
  // DOM refs
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const articlesGrid = document.getElementById('articlesGrid');
  const emptyState = document.getElementById('emptyState');
  const totalArticlesEl = document.getElementById('totalArticles');
  const sitesCountEl = document.getElementById('sitesCount');
  const lastUpdatedEl = document.getElementById('lastUpdated');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnDigestMode = document.getElementById('btnDigestMode');
  const autoRefreshToggle = document.getElementById('autoRefresh');
  const siteTabs = document.getElementById('siteTabs').querySelector('.tabs-inner');
  const toast = document.getElementById('toast');

  // ===== Utility Functions =====
  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date)) return '';
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 0) return 'たった今';
    if (diff < 60) return `${diff}秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  }

  function showToast(msg, duration = 3000) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  }

  function formatTime(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    if (isNaN(d)) return '--';
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ===== View Switching =====
  const viewTabNews = document.getElementById('viewTabNews');
  const viewTabTasks = document.getElementById('viewTabTasks');
  const newsView = document.getElementById('newsView');
  const tasksView = document.getElementById('tasksView');

  function switchView(view) {
    currentView = view;
    viewTabNews.classList.toggle('active', view === 'news');
    viewTabTasks.classList.toggle('active', view === 'tasks');
    newsView.classList.toggle('hidden', view !== 'news');
    tasksView.classList.toggle('hidden', view !== 'tasks');
  }

  viewTabNews.addEventListener('click', () => switchView('news'));
  viewTabTasks.addEventListener('click', () => switchView('tasks'));

  // ===== Fetch Articles =====
  async function fetchAllSites() {
    if (isLoading) return;
    isLoading = true;

    loadingState.classList.remove('hidden');
    errorState.classList.add('hidden');
    articlesGrid.classList.add('hidden');
    emptyState.classList.add('hidden');
    btnRefresh.classList.add('loading');

    try {
      const res = await fetch('./articles.json');
      if (!res.ok) throw new Error('Data fetch error: ' + res.status);
      const data = await res.json();

      if (!data.ok || !data.articles) throw new Error('Invalid response');

      allArticles = data.articles;
      sitesConfig = data.sites || [];

      if (allArticles.length === 0) {
        loadingState.classList.add('hidden');
        errorState.classList.remove('hidden');
        return;
      }

      const activeSites = new Set(allArticles.map(a => a.siteId)).size;
      totalArticlesEl.textContent = allArticles.length;
      sitesCountEl.textContent = activeSites;
      lastUpdatedEl.textContent = `最終更新: ${formatTime(data.updatedAt)}`;

      buildTabs(allArticles);
      renderArticles();

      loadingState.classList.add('hidden');
      articlesGrid.classList.remove('hidden');
      showToast(`✅ ${allArticles.length}件の記事を取得しました`);

    } catch (err) {
      console.error('Fetch error:', err);
      loadingState.classList.add('hidden');
      errorState.classList.remove('hidden');
    } finally {
      isLoading = false;
      btnRefresh.classList.remove('loading');
    }
  }

  // ===== Build Tabs =====
  function buildTabs(articles) {
    const existingTabs = siteTabs.querySelectorAll('[data-site]:not([data-site="all"])');
    existingTabs.forEach(t => t.remove());

    const siteGroups = {};
    articles.forEach(a => {
      if (!siteGroups[a.siteId]) siteGroups[a.siteId] = { count: 0, article: a };
      siteGroups[a.siteId].count++;
    });

    Object.values(siteGroups).forEach(({ count, article }) => {
      const conf = sitesConfig.find(s => s.id === article.siteId);
      const gradient = conf ? conf.gradient : 'linear-gradient(135deg, #a78bfa, #60a5fa)';

      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.dataset.site = article.siteId;
      btn.innerHTML = `
        <span class="tab-dot" style="background: ${gradient}"></span>
        ${article.siteShortName}
        <span class="tab-count">${count}</span>
      `;
      btn.addEventListener('click', () => selectTab(article.siteId));
      siteTabs.appendChild(btn);
    });

    const allTab = siteTabs.querySelector('[data-site="all"]');
    if (allTab) {
      allTab.innerHTML = `
        <span class="tab-dot" style="background: linear-gradient(135deg, #a78bfa, #60a5fa)"></span>
        すべて
        <span class="tab-count">${articles.length}</span>
      `;
    }
  }

  // ===== Select Tab =====
  function selectTab(siteId) {
    currentSite = siteId;
    siteTabs.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.site === siteId);
    });
    renderArticles();
  }

  // ===== Render Articles =====
  function renderArticles() {
    const filtered = currentSite === 'all'
      ? allArticles
      : allArticles.filter(a => a.siteId === currentSite);

    let displayed = filtered;
    if (digestMode) {
      if (currentSite === 'all') {
        const counts = {};
        displayed = filtered.filter(a => {
          counts[a.siteId] = (counts[a.siteId] || 0) + 1;
          return counts[a.siteId] <= 3;
        });
      } else {
        displayed = filtered.slice(0, 10);
      }
    }

    if (displayed.length === 0) {
      articlesGrid.classList.add('hidden');
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    articlesGrid.classList.remove('hidden');
    articlesGrid.innerHTML = '';

    displayed.forEach((article, i) => {
      const card = buildCard(article, i);
      articlesGrid.appendChild(card);
    });

    articlesGrid.classList.toggle('digest-mode', digestMode);
  }

  // ===== Build Card =====
  function buildCard(article, index) {
    const card = document.createElement('div');
    card.className = 'article-card';
    card.style.animationDelay = `${Math.min(index * 0.035, 0.5)}s`;

    const conf = sitesConfig.find(s => s.id === article.siteId);
    const gradient = conf?.gradient || article.siteGradient || 'linear-gradient(135deg, #a78bfa, #60a5fa)';
    const color = conf?.color || article.siteColor || '#a78bfa';
    const bgAlpha = conf?.bgAlpha || article.siteBgAlpha || 'rgba(167,139,250,0.12)';

    const safeLink = escapeHtml(article.link || '#');

    const thumbnailHtml = article.thumbnail
      ? `<div class="card-thumbnail-container"><img src="${escapeHtml(article.thumbnail)}" class="card-thumbnail" loading="lazy" alt="Thumbnail"></div>`
      : '';

    card.innerHTML = `
      <div class="card-site-bar" style="background: ${gradient}"></div>
      ${thumbnailHtml}
      <div class="card-body">
        <div class="card-meta">
          <span class="card-site-badge" style="background: ${bgAlpha}; color: ${color};">
            <span class="card-site-dot" style="background: ${color}"></span>
            ${escapeHtml(article.siteShortName)}
          </span>
          <span class="card-time">${timeAgo(article.pubDate)}</span>
        </div>
        <h2 class="card-title">${escapeHtml(article.title)}</h2>
        ${article.description ? `<p class="card-description">${escapeHtml(article.description)}</p>` : ''}
      </div>
      <div class="card-footer">
        <a class="card-link-btn" href="${safeLink}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">
          記事を読む
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="7" y1="17" x2="17" y2="7"></line>
            <polyline points="7 7 17 7 17 17"></polyline>
          </svg>
        </a>
      </div>
    `;

    card.addEventListener('click', () => {
      if (article.link) window.open(article.link, '_blank', 'noopener,noreferrer');
    });

    return card;
  }

  // ===== Task Functions =====
  const taskInput = document.getElementById('taskInput');
  const taskAddBtn = document.getElementById('taskAddBtn');
  const taskList = document.getElementById('taskList');
  const taskEmpty = document.getElementById('taskEmpty');
  const taskBadge = document.getElementById('taskBadge');

  function addTask() {
    const text = taskInput.value.trim();
    if (!text) return;
    tasks.unshift({
      id: Date.now().toString(),
      text,
      done: false,
      createdAt: new Date().toISOString(),
    });
    saveTasks();
    taskInput.value = '';
    renderTasks();
    showToast('📋 タスクを追加しました');
  }

  function toggleTask(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.done = !task.done;
      saveTasks();
      renderTasks();
    }
  }

  function deleteTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    renderTasks();
    showToast('🗑️ タスクを削除しました');
  }

  function renderTasks() {
    const pending = tasks.filter(t => !t.done);
    const completed = tasks.filter(t => t.done);

    // Update badge
    if (pending.length > 0) {
      taskBadge.textContent = pending.length;
      taskBadge.classList.remove('hidden');
    } else {
      taskBadge.classList.add('hidden');
    }

    if (tasks.length === 0) {
      taskList.classList.add('hidden');
      taskEmpty.classList.remove('hidden');
      return;
    }

    taskEmpty.classList.add('hidden');
    taskList.classList.remove('hidden');
    taskList.innerHTML = '';

    // Pending tasks
    if (pending.length > 0) {
      const pendingSection = document.createElement('div');
      pendingSection.className = 'task-section';
      pendingSection.innerHTML = `<div class="task-section-title">📌 未完了 <span class="task-section-count">${pending.length}</span></div>`;
      pending.forEach((task, i) => {
        pendingSection.appendChild(buildTaskItem(task, i));
      });
      taskList.appendChild(pendingSection);
    }

    // Completed tasks
    if (completed.length > 0) {
      const doneSection = document.createElement('div');
      doneSection.className = 'task-section';
      doneSection.innerHTML = `<div class="task-section-title">✅ 完了済み <span class="task-section-count">${completed.length}</span></div>`;
      completed.forEach((task, i) => {
        doneSection.appendChild(buildTaskItem(task, i));
      });
      taskList.appendChild(doneSection);
    }
  }

  function buildTaskItem(task, index) {
    const item = document.createElement('div');
    item.className = `task-item ${task.done ? 'done' : ''}`;
    item.style.animationDelay = `${Math.min(index * 0.04, 0.3)}s`;

    const timeStr = timeAgo(task.createdAt);

    item.innerHTML = `
      <button class="task-check" data-id="${task.id}" aria-label="完了切り替え">
        ${task.done
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>'
        }
      </button>
      <div class="task-content">
        <span class="task-text">${escapeHtml(task.text)}</span>
        <span class="task-time">${timeStr}</span>
      </div>
      <button class="task-delete" data-id="${task.id}" aria-label="削除">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    `;

    item.querySelector('.task-check').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTask(task.id);
    });
    item.querySelector('.task-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(task.id);
    });

    return item;
  }

  taskAddBtn.addEventListener('click', addTask);
  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
  });

  // ===== Event Listeners =====
  btnRefresh.addEventListener('click', fetchAllSites);
  document.getElementById('btnRetry').addEventListener('click', fetchAllSites);

  btnDigestMode.addEventListener('click', () => {
    digestMode = !digestMode;
    btnDigestMode.classList.toggle('active', digestMode);
    renderArticles();
    showToast(digestMode ? '⚡ ダイジェストモード ON' : '📋 通常モードに切り替えました');
  });

  autoRefreshToggle.addEventListener('change', () => {
    if (autoRefreshToggle.checked) {
      autoRefreshTimer = setInterval(fetchAllSites, 5 * 60 * 1000);
      showToast('🔄 5分ごとに自動更新します');
    } else {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      showToast('自動更新をオフにしました');
    }
  });

  document.getElementById('tab-all').addEventListener('click', () => selectTab('all'));

  // ===== Init =====
  loadTasks();
  renderTasks();
  fetchAllSites();
}

// ===== Start =====
checkPin();
