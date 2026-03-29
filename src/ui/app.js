/* agent-knowledge dashboard — vanilla JS SPA */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    activeTab: 'knowledge',
    knowledge: { entries: [], activeCategory: 'all' },
    search: {
      query: '',
      results: [],
      role: 'all',
      scope: 'all',
      ranked: true,
      semantic: false,
      loading: false,
    },
    sessions: { list: [], projectFilter: '', loading: false },
    embeddings: { stats: null, loading: false },
    panel: { open: false, type: null, data: null },
    stats: { knowledgeCount: 0, sessionCount: 0, vectorCount: 0 },
    connected: false,
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const el = {
    tabs: {
      knowledge: $('tab-knowledge'),
      search: $('tab-search'),
      sessions: $('tab-sessions'),
      embeddings: $('tab-embeddings'),
    },
    views: {
      knowledge: $('view-knowledge'),
      search: $('view-search'),
      sessions: $('view-sessions'),
      embeddings: $('view-embeddings'),
    },
    knowledgeGrid: $('knowledge-grid'),
    knowledgeEmpty: $('knowledge-empty'),
    knowledgeCategories: $('knowledge-categories'),
    searchInput: $('search-input'),
    searchResults: $('search-results'),
    searchEmpty: $('search-empty'),
    searchRoleFilters: $('search-role-filters'),
    modeRanked: $('mode-ranked'),
    modeSemantic: $('mode-semantic'),
    modeRegex: $('mode-regex'),
    sessionsList: $('sessions-list'),
    sessionsEmpty: $('sessions-empty'),
    sessionProjectFilter: $('session-project-filter'),
    searchScopes: $('search-scopes'),
    sidePanel: $('side-panel'),
    panelTitle: $('panel-title'),
    panelBody: $('panel-body'),
    panelClose: $('panel-close'),
    connectionStatus: $('connection-status'),
    statKnowledge: $('stat-knowledge'),
    statSessions: $('stat-sessions'),
    statVectors: $('stat-vectors'),
    embeddingsStatsGrid: $('embedding-stats-grid'),
    embeddingsEmpty: $('embeddings-empty'),
    embeddingsStatus: $('embeddings-status'),
    themeToggle: $('theme-toggle'),
    version: $('version'),
    loadingOverlay: $('loading-overlay'),
    toastContainer: $('toast-container'),
    contentWrapper: $('content-wrapper'),
  };

  // ── Utilities ──────────────────────────────────────────────────────────────

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function relativeTime(dateStr) {
    if (!dateStr) return '';
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    if (diff < 0) return 'just now';
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  function renderMd(raw) {
    if (!raw) return '';
    try {
      const html = marked.parse(raw, { breaks: true, gfm: true });
      const clean = DOMPurify.sanitize(html, { ADD_TAGS: ['pre', 'code'] });
      const wrapper = document.createElement('div');
      wrapper.innerHTML = clean;
      wrapper.querySelectorAll('pre code').forEach((block) => {
        try {
          hljs.highlightElement(block);
        } catch (_) {
          /* noop */
        }
      });
      return wrapper.innerHTML;
    } catch {
      return esc(raw);
    }
  }

  function highlightExcerpt(text, query) {
    if (!text || !query) return esc(text || '');
    try {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(${escaped})`, 'gi');
      return esc(text).replace(re, '<mark>$1</mark>');
    } catch {
      return esc(text);
    }
  }

  function formatScore(score, metadata) {
    if (score == null) return '';
    const pct = Math.min(Math.max(score * 100, 0), 100);
    const tfidf = metadata?.tfidfScore;
    const semantic = metadata?.semanticScore;
    const recency = metadata?.recencyMultiplier;
    const alpha = metadata?.blendAlpha;

    let tooltip = `Score: ${score.toFixed(3)}`;
    if (tfidf != null && semantic != null) {
      tooltip += ` (TF-IDF: ${tfidf.toFixed(2)} \u00d7 ${((alpha || 0.3) * 100).toFixed(0)}% + Semantic: ${semantic.toFixed(2)} \u00d7 ${((1 - (alpha || 0.3)) * 100).toFixed(0)}%)`;
    }
    if (recency != null) tooltip += ` \u00d7 recency ${(recency * 100).toFixed(0)}%`;

    const recencyTag =
      recency != null && recency < 0.95
        ? `<span class="recency-tag" title="Recency: ${(recency * 100).toFixed(0)}%">${(recency * 100).toFixed(0)}%</span>`
        : '';
    const scoreType =
      tfidf != null && semantic != null
        ? '<span class="score-type hybrid">hybrid</span>'
        : tfidf != null
          ? '<span class="score-type tfidf">tf-idf</span>'
          : '';
    return `<div class="score-bar" title="${tooltip}">
      <div class="score-fill" style="width:${pct}%"></div>
      <span class="score-label">${score.toFixed(2)}${recencyTag}${scoreType}</span>
    </div>`;
  }

  function toast(msg, type = 'info', duration = 4000) {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const icons = { info: 'info', success: 'check_circle', error: 'error', warning: 'warning' };
    t.innerHTML = `<span class="material-symbols-outlined toast-icon">${icons[type] || 'info'}</span>
      <span class="toast-msg">${esc(msg)}</span>`;
    el.toastContainer.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      t.addEventListener('transitionend', () => t.remove());
    }, duration);
  }

  // ── API ────────────────────────────────────────────────────────────────────

  async function api(path) {
    const res = await fetch(`/api${path}`);
    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
    return res.json();
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  let ws = null;
  let wsRetry = null;

  function wsConnect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => {
      state.connected = true;
      updateConnectionStatus();
      el.loadingOverlay.classList.add('hidden');
      if (wsRetry) {
        clearTimeout(wsRetry);
        wsRetry = null;
      }
    });

    ws.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        handleWsMessage(msg);
      } catch {
        /* ignore non-json */
      }
    });

    ws.addEventListener('close', () => {
      state.connected = false;
      updateConnectionStatus();
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      state.connected = false;
      updateConnectionStatus();
    });
  }

  function scheduleReconnect() {
    if (wsRetry) return;
    wsRetry = setTimeout(() => {
      wsRetry = null;
      wsConnect();
    }, 3000);
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'reload':
        location.reload();
        return;
      case 'state':
        if (msg.knowledge) {
          state.knowledge.entries = msg.knowledge;
          renderKnowledge();
        }
        if (msg.sessions) {
          state.sessions.list = msg.sessions;
          renderSessions();
        }
        if (msg.stats) {
          state.stats.knowledgeCount = msg.stats.knowledge_entries || 0;
          state.stats.sessionCount = msg.stats.session_count || 0;
          state.stats.vectorCount = msg.stats.vector_count || 0;
          if (msg.stats.version) el.version.textContent = 'v' + msg.stats.version;
          updateStats();
        }
        el.loadingOverlay.classList.add('hidden');
        break;
      case 'knowledge:update':
      case 'knowledge:change':
        loadKnowledge();
        break;
      case 'session:update':
      case 'session:new':
        loadSessions();
        break;
      case 'stats':
        if (msg.data) {
          if (msg.data.knowledgeCount != null) state.stats.knowledgeCount = msg.data.knowledgeCount;
          if (msg.data.sessionCount != null) state.stats.sessionCount = msg.data.sessionCount;
          if (msg.data.vectorCount != null) state.stats.vectorCount = msg.data.vectorCount;
          updateStats();
        }
        break;
      case 'version':
        if (msg.data) el.version.textContent = msg.data;
        break;
      default:
        break;
    }
  }

  function updateConnectionStatus() {
    const s = el.connectionStatus;
    if (state.connected) {
      s.className = 'status-badge connected';
      s.textContent = 'Connected';
    } else {
      s.className = 'status-badge disconnected';
      s.textContent = 'Disconnected';
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  function updateStats() {
    el.statKnowledge.querySelector('.stat-value').textContent = state.stats.knowledgeCount;
    el.statSessions.querySelector('.stat-value').textContent = state.stats.sessionCount;
    el.statVectors.querySelector('.stat-value').textContent = state.stats.vectorCount;
  }

  // ── Theme ──────────────────────────────────────────────────────────────────

  function initTheme() {
    const saved = localStorage.getItem('agent-knowledge-theme');
    const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('agent-knowledge-theme', theme);
    const icon = el.themeToggle.querySelector('.theme-icon');
    if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────

  function switchTab(name, updateHash = true) {
    if (state.activeTab === name) return;
    state.activeTab = name;
    if (updateHash) location.hash = '#' + name;

    Object.keys(el.tabs).forEach((k) => {
      const active = k === name;
      el.tabs[k].classList.toggle('active', active);
      el.tabs[k].setAttribute('aria-selected', active);
    });

    Object.keys(el.views).forEach((k) => {
      const active = k === name;
      el.views[k].classList.toggle('active', active);
      el.views[k].hidden = !active;
    });

    // Close side panel on tab switch
    if (state.panel.open) closePanel();

    if (name === 'knowledge' && state.knowledge.entries.length === 0) loadKnowledge();
    if (name === 'sessions' && state.sessions.list.length === 0) loadSessions();
    if (name === 'embeddings') loadEmbeddingStats();
  }

  // ── Knowledge ──────────────────────────────────────────────────────────────

  async function loadKnowledge() {
    try {
      const data = await api('/knowledge');
      const entries = Array.isArray(data) ? data : data.entries || [];
      state.knowledge.entries = entries;
      state.stats.knowledgeCount = entries.length;
      updateStats();
      renderKnowledge();
    } catch (err) {
      toast(`Failed to load knowledge: ${err.message}`, 'error');
    }
  }

  function renderKnowledge() {
    const cat = state.knowledge.activeCategory;
    const filtered =
      cat === 'all'
        ? state.knowledge.entries
        : state.knowledge.entries.filter((e) => e.category === cat);

    if (filtered.length === 0) {
      el.knowledgeGrid.innerHTML = '';
      el.knowledgeEmpty.classList.remove('hidden');
      return;
    }

    el.knowledgeEmpty.classList.add('hidden');
    el.knowledgeGrid.innerHTML = filtered
      .map((entry) => {
        const cat = entry.category || 'notes';
        const catIcons = {
          projects: 'code',
          people: 'group',
          decisions: 'gavel',
          workflows: 'account_tree',
          notes: 'sticky_note_2',
        };
        const icon = catIcons[cat] || 'article';
        const title = entry.title || entry.path || entry.id || 'Untitled';
        const preview = entry.preview || entry.excerpt || '';
        const tags = (entry.tags || [])
          .slice(0, 3)
          .map((t) => `<span class="card-tag">${esc(t)}</span>`)
          .join('');
        const time = relativeTime(entry.updated || entry.created);

        return `<div class="knowledge-card" data-path="${esc(entry.path || entry.id || '')}" tabindex="0" role="button">
        <span class="card-category" data-cat="${esc(cat)}">
          <span class="material-symbols-outlined" style="font-size:14px">${icon}</span>
          ${esc(cat)}
        </span>
        ${time ? `<span class="card-date">${time}</span>` : ''}
        <div class="card-title">${esc(title)}</div>
        ${tags ? `<div class="card-tags">${tags}</div>` : ''}
      </div>`;
      })
      .join('');

    el.knowledgeGrid.querySelectorAll('.knowledge-card').forEach((card) => {
      card.addEventListener('click', () => openKnowledgePanel(card.dataset.path));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') openKnowledgePanel(card.dataset.path);
      });
    });
  }

  async function openKnowledgePanel(path) {
    if (!path) return;
    try {
      const data = await api(`/knowledge/${encodeURIComponent(path)}`);
      const title = data.title || data.path || path;
      const content = data.content || data.body || '';
      openPanel('knowledge', { title, content, meta: data });
    } catch (err) {
      toast(`Failed to load entry: ${err.message}`, 'error');
    }
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  const doSearch = debounce(async () => {
    const q = state.search.query.trim();
    if (!q) {
      state.search.results = [];
      renderSearchResults();
      return;
    }
    state.search.loading = true;
    renderSearchResults();
    try {
      const params = new URLSearchParams({ q });
      let endpoint;
      if (state.search.scope !== 'all') {
        params.set('scope', state.search.scope);
        params.set('semantic', state.search.semantic);
        endpoint = `/sessions/recall?${params}`;
      } else {
        if (state.search.role !== 'all') params.set('role', state.search.role);
        params.set('ranked', state.search.ranked);
        params.set('semantic', state.search.semantic);
        endpoint = `/sessions/search?${params}`;
      }
      const data = await api(endpoint);
      state.search.results = Array.isArray(data) ? data : data.results || [];
    } catch (err) {
      toast(`Search failed: ${err.message}`, 'error');
      state.search.results = [];
    }
    state.search.loading = false;
    renderSearchResults();
  }, 300);

  function renderSearchResults() {
    const { results, loading, query } = state.search;

    if (loading) {
      el.searchResults.innerHTML =
        '<div class="loading-inline"><div class="loading-spinner small"></div><span>Searching...</span></div>';
      el.searchEmpty.classList.add('hidden');
      return;
    }

    if (!query.trim()) {
      el.searchResults.innerHTML = '';
      el.searchEmpty.classList.remove('hidden');
      return;
    }

    if (results.length === 0) {
      el.searchResults.innerHTML = '';
      el.searchEmpty.querySelector('.empty-text').textContent = 'No results found';
      el.searchEmpty.querySelector('.empty-hint').textContent = `No matches for "${query}"`;
      el.searchEmpty.classList.remove('hidden');
      return;
    }

    el.searchEmpty.classList.add('hidden');
    el.searchResults.innerHTML = results
      .map((r) => {
        const sessionId = r.id || r.sessionId || r.session_id || '';
        const excerpt = r.excerpt || r.text || r.content || '';
        const role = r.role || '';
        const score = r.score;
        const meta = r.metadata;
        const project = r.project || '';
        const time = relativeTime(r.timestamp || r.date);
        const roleIcon = role === 'user' ? 'person' : role === 'assistant' ? 'smart_toy' : 'chat';

        return `<div class="result-item" data-session-id="${esc(sessionId)}" data-excerpt="${esc(excerpt)}" tabindex="0" role="button">
        <div class="result-meta">
          <span class="role-badge" data-role="${esc(role)}"><span class="material-symbols-outlined" style="font-size:12px">${roleIcon}</span> ${esc(role)}</span>
          ${project ? `<span class="result-project">${esc(project)}</span>` : ''}
          ${time ? `<span class="result-date">${time}</span>` : ''}
          ${score != null ? `<span class="score-container">${formatScore(score, meta)}</span>` : ''}
        </div>
        <div class="result-excerpt">${highlightExcerpt(excerpt, query)}</div>
      </div>`;
      })
      .join('');

    el.searchResults.querySelectorAll('.result-item').forEach((card) => {
      card.addEventListener('click', () =>
        openSessionPanel(card.dataset.sessionId, card.dataset.excerpt),
      );
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') openSessionPanel(card.dataset.sessionId, card.dataset.excerpt);
      });
    });
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async function loadSessions() {
    if (state.sessions.loading) return;
    state.sessions.loading = true;
    try {
      const data = await api('/sessions');
      const list = Array.isArray(data) ? data : data.sessions || [];
      state.sessions.list = list;
      state.stats.sessionCount = list.length;
      updateStats();
      populateProjectFilter(list);
      renderSessions();
    } catch (err) {
      toast(`Failed to load sessions: ${err.message}`, 'error');
    }
    state.sessions.loading = false;
  }

  function populateProjectFilter(sessions) {
    const projects = [...new Set(sessions.map((s) => s.project).filter(Boolean))].sort();
    const sel = el.sessionProjectFilter;
    const current = sel.value;
    sel.innerHTML =
      '<option value="">All projects</option>' +
      projects.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    sel.value = current;
  }

  function renderSessions() {
    const filter = state.sessions.projectFilter;
    const list = filter
      ? state.sessions.list.filter((s) => s.project === filter)
      : state.sessions.list;

    if (list.length === 0) {
      el.sessionsList.innerHTML = '';
      el.sessionsEmpty.classList.remove('hidden');
      return;
    }

    el.sessionsEmpty.classList.add('hidden');
    el.sessionsList.innerHTML = list
      .map((s) => {
        const id = s.sessionId || s.id || '';
        const project = s.project || '';
        const branch = s.branch || s.gitBranch || s.git_branch || '';
        const count = s.messageCount || s.message_count || s.count || 0;
        const date = s.startTime || s.date || s.created || s.startedAt || '';
        const preview = s.preview || '';
        const time = relativeTime(date);
        const dateStr = date
          ? new Date(date).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : '';

        const title = preview
          ? preview.length > 80
            ? preview.slice(0, 80) + '…'
            : preview
          : id.slice(0, 8);

        return `<div class="session-card" data-session-id="${esc(id)}" tabindex="0" role="button">
        <div class="session-header">
          <span class="session-title">${esc(title)}</span>
          <span class="session-date">${dateStr || time || ''}</span>
        </div>
        <div class="session-meta">
          <span class="session-meta-item"><span class="material-symbols-outlined">folder</span>${esc(project)}</span>
          ${branch ? `<span class="session-meta-item"><span class="material-symbols-outlined">alt_route</span>${esc(branch)}</span>` : ''}
          <span class="session-meta-item"><span class="material-symbols-outlined">chat</span>${count} messages</span>
          <span class="session-meta-item"><span class="material-symbols-outlined">tag</span>${esc(id.slice(0, 8))}</span>
        </div>
      </div>`;
      })
      .join('');

    el.sessionsList.querySelectorAll('.session-card').forEach((card) => {
      card.addEventListener('click', () => openSessionPanel(card.dataset.sessionId));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') openSessionPanel(card.dataset.sessionId);
      });
    });
  }

  async function openSessionPanel(sessionId, searchExcerpt) {
    if (!sessionId) return;
    try {
      const [session, summary] = await Promise.allSettled([
        api(`/sessions/${encodeURIComponent(sessionId)}`),
        api(`/sessions/${encodeURIComponent(sessionId)}/summary`),
      ]);
      const sData = session.status === 'fulfilled' ? session.value : {};
      const sumData = summary.status === 'fulfilled' ? summary.value : null;
      openPanel('session', { session: sData, summary: sumData, sessionId, searchExcerpt });
    } catch (err) {
      toast(`Failed to load session: ${err.message}`, 'error');
    }
  }

  // ── Embeddings ─────────────────────────────────────────────────────────────

  async function loadEmbeddingStats() {
    try {
      const data = await api('/index-status');
      state.embeddings.stats = data;
      renderEmbeddingStats();
      el.statVectors.querySelector('.stat-value').textContent = data.totalEntries || 0;
    } catch {
      state.embeddings.stats = null;
      renderEmbeddingStats();
    }
  }

  function renderEmbeddingStats() {
    const stats = state.embeddings.stats;
    if (!stats || !stats.totalEntries) {
      el.embeddingsStatsGrid.innerHTML = '';
      el.embeddingsStatus.style.display = 'none';
      el.embeddingsEmpty.classList.remove('hidden');
      return;
    }

    el.embeddingsEmpty.classList.add('hidden');
    el.embeddingsStatus.style.display = '';

    const cards = [
      { label: 'Provider', value: stats.provider || 'Not configured', detail: '' },
      { label: 'Dimensions', value: stats.dimensions || 0, detail: 'vector size' },
      { label: 'Total Chunks', value: stats.totalEntries || 0, detail: 'indexed chunks' },
      { label: 'Knowledge', value: stats.knowledgeEntries || 0, detail: 'knowledge chunks' },
      {
        label: 'Sessions',
        value: stats.uniqueSessions || 0,
        detail: `${stats.sessionEntries || 0} chunks`,
      },
      { label: 'DB Size', value: (stats.dbSizeMB || 0).toFixed(1) + ' MB', detail: 'on disk' },
    ];

    el.embeddingsStatsGrid.innerHTML = cards
      .map(
        (c) => `
      <div class="embedding-stat-card">
        <span class="stat-label">${esc(c.label)}</span>
        <span class="stat-number">${esc(String(c.value))}</span>
        ${c.detail ? `<span class="stat-detail">${esc(c.detail)}</span>` : ''}
      </div>
    `,
      )
      .join('');
  }

  // ── Side Panel ─────────────────────────────────────────────────────────────

  function openPanel(type, data) {
    state.panel = { open: true, type, data };
    el.sidePanel.hidden = false;
    requestAnimationFrame(() => el.sidePanel.classList.add('open'));
    el.contentWrapper.classList.add('panel-visible');

    if (type === 'knowledge') {
      renderKnowledgePanel(data);
    } else if (type === 'session') {
      renderSessionPanel(data);
    }
  }

  function closePanel() {
    state.panel = { open: false, type: null, data: null };
    el.sidePanel.classList.remove('open');
    el.contentWrapper.classList.remove('panel-visible');
    el.sidePanel.addEventListener(
      'transitionend',
      function handler() {
        if (!state.panel.open) el.sidePanel.hidden = true;
        el.sidePanel.removeEventListener('transitionend', handler);
      },
      { once: true },
    );
    // Fallback: hide after 400ms if transitionend doesn't fire
    setTimeout(() => {
      if (!state.panel.open) el.sidePanel.hidden = true;
    }, 400);
  }

  function stripFrontmatter(content) {
    const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    return match ? match[1].trim() : content;
  }

  function renderKnowledgePanel(data) {
    el.panelTitle.innerHTML = `<span class="material-symbols-outlined panel-icon">article</span>${esc(data.title)}`;
    const meta = data.meta || {};
    const entry = meta.entry || meta;
    const category = entry.category || meta.category || '';
    const tags = entry.tags || meta.tags || [];
    const updated = entry.updated || meta.updated || '';

    let metaHtml = '<div class="panel-meta">';
    if (category)
      metaHtml += `<span class="card-category" data-cat="${esc(category)}">${esc(category)}</span>`;
    if (tags.length)
      metaHtml += tags.map((t) => `<span class="card-tag">${esc(t)}</span>`).join('');
    if (updated) metaHtml += `<span class="panel-meta-date">${esc(updated)}</span>`;
    metaHtml += '</div>';

    const body = stripFrontmatter(data.content);
    el.panelBody.innerHTML = metaHtml + `<div class="prose">${renderMd(body)}</div>`;
  }

  function renderSessionPanel(data) {
    const s = data.session || {};
    const summary = data.summary;
    const id = data.sessionId || s.id || '';
    const meta = s.meta || s;

    el.panelTitle.innerHTML = `<span class="material-symbols-outlined panel-icon">terminal</span>Session ${esc(id.slice(0, 8))}`;

    let html = '<div class="panel-meta">';
    if (meta.cwd)
      html += `<span class="panel-meta-item"><span class="material-symbols-outlined" style="font-size:14px">folder</span>${esc(meta.cwd)}</span>`;
    if (meta.branch)
      html += `<span class="panel-meta-item"><span class="material-symbols-outlined" style="font-size:14px">alt_route</span>${esc(meta.branch)}</span>`;
    if (meta.startTime && meta.startTime !== 'unknown')
      html += `<span class="panel-meta-item"><span class="material-symbols-outlined" style="font-size:14px">schedule</span>${new Date(meta.startTime).toLocaleString()}</span>`;
    if (meta.messageCount)
      html += `<span class="panel-meta-item"><span class="material-symbols-outlined" style="font-size:14px">chat</span>${meta.messageCount} messages</span>`;
    html += '</div>';

    if (summary && summary.topics && summary.topics.length) {
      html +=
        '<div class="panel-section"><h4 class="panel-section-title">Topics</h4><ul class="panel-topics">';
      summary.topics.slice(0, 8).forEach((t) => {
        html += `<li>${esc(t.content)}</li>`;
      });
      html += '</ul></div>';
    }

    const messages = s.messages || s.conversation || [];
    // Filter out noisy messages (tool JSON, base64, system reminders)
    const cleanMessages = messages.filter((m) => {
      const t = (m.content || '').trimStart();
      if (t.startsWith('[{') || t.startsWith('{"')) return false;
      if (t.includes('tool_use_id') || t.includes('tool_result')) return false;
      if (t.includes('base64') || t.includes('media_type')) return false;
      if (t.includes('<system-reminder>')) return false;
      if (t.length < 3) return false;
      return true;
    });

    if (cleanMessages.length) {
      html += '<div class="chat-messages">';
      cleanMessages.forEach((m) => {
        const role = m.role || 'unknown';
        const text = m.content || m.text || '';
        const isUser = role === 'user';
        const cls = isUser ? 'chat-msg user' : 'chat-msg assistant';
        const roleIcon = isUser ? 'person' : 'smart_toy';
        const truncated = text.length > 1500 ? text.slice(0, 1500) + '...' : text;
        const time = m.timestamp ? relativeTime(m.timestamp) : '';

        html += `<div class="${cls}">
          <div class="chat-msg-role"><span class="material-symbols-outlined" style="font-size:14px">${roleIcon}</span> ${esc(role)} ${time ? `<span class="chat-msg-time">${time}</span>` : ''}</div>
          <div>${isUser ? esc(truncated) : renderMd(truncated)}</div>
        </div>`;
      });
      html += '</div>';
    } else {
      html +=
        '<div class="empty-state"><span class="material-symbols-outlined empty-icon">chat_bubble</span><div class="empty-text">No messages available</div></div>';
    }

    el.panelBody.innerHTML = html;

    // Scroll to and highlight matching message from search
    if (data.searchExcerpt) {
      setTimeout(() => {
        const excerpt = data.searchExcerpt.replace(/\s+/g, ' ').trim().toLowerCase();
        const msgEls = el.panelBody.querySelectorAll('.chat-msg');
        let bestMatch = null;
        let bestScore = -1;
        msgEls.forEach((msgEl) => {
          const text = msgEl.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
          // Exact substring match scores highest (2 + length ratio)
          if (text.includes(excerpt)) {
            const score = 2 + excerpt.length / text.length;
            if (score > bestScore) {
              bestScore = score;
              bestMatch = msgEl;
            }
          } else {
            // Fuzzy: check word overlap
            const words = excerpt.split(' ').filter((w) => w.length > 2);
            if (words.length > 0) {
              const matched = words.filter((w) => text.includes(w)).length;
              const ratio = matched / words.length;
              if (ratio > 0.5 && ratio > bestScore) {
                bestScore = ratio;
                bestMatch = msgEl;
              }
            }
          }
        });
        if (bestMatch) {
          bestMatch.classList.add('chat-msg-highlight');
          bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => bestMatch.classList.remove('chat-msg-highlight'), 4000);
        }
      }, 300);
    }
  }

  // ── Event Binding ──────────────────────────────────────────────────────────

  function bindEvents() {
    // Tabs
    Object.keys(el.tabs).forEach((k) => {
      el.tabs[k].addEventListener('click', () => switchTab(k));
    });

    // Theme
    el.themeToggle.addEventListener('click', toggleTheme);

    // Panel close
    el.panelClose.addEventListener('click', closePanel);

    // Knowledge category chips
    el.knowledgeCategories.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      el.knowledgeCategories.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.knowledge.activeCategory = chip.dataset.category;
      renderKnowledge();
    });

    // Search input
    el.searchInput.addEventListener('input', () => {
      state.search.query = el.searchInput.value;
      doSearch();
    });

    // Search role filters
    el.searchRoleFilters.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      el.searchRoleFilters.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.search.role = chip.dataset.role;
      if (state.search.query.trim()) doSearch();
    });

    function setSearchMode(mode) {
      el.modeRanked.classList.toggle('active', mode === 'ranked');
      el.modeSemantic.classList.toggle('active', mode === 'semantic');
      el.modeRegex.classList.toggle('active', mode === 'regex');
      state.search.ranked = mode !== 'regex';
      state.search.semantic = mode === 'semantic';
      if (state.search.query.trim()) doSearch();
    }

    el.modeRanked.addEventListener('click', () => setSearchMode('ranked'));
    el.modeSemantic.addEventListener('click', () => setSearchMode('semantic'));
    el.modeRegex.addEventListener('click', () => setSearchMode('regex'));

    // Session project filter
    el.sessionProjectFilter.addEventListener('change', () => {
      state.sessions.projectFilter = el.sessionProjectFilter.value;
      renderSessions();
    });

    // Search scope chips
    el.searchScopes.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      el.searchScopes.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.search.scope = chip.dataset.scope;
      if (state.search.query.trim()) doSearch();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Escape closes panel
      if (e.key === 'Escape' && state.panel.open) {
        e.preventDefault();
        closePanel();
        return;
      }

      // / or Ctrl+K focuses search
      if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && !isInputFocused()) {
        e.preventDefault();
        switchTab('search');
        el.searchInput.focus();
      }
    });

    // Click outside panel to close
    el.contentWrapper.addEventListener('click', (e) => {
      if (state.panel.open && !el.sidePanel.contains(e.target)) {
        // Only close if clicking on the main content area backdrop
      }
    });
  }

  function isInputFocused() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || active.isContentEditable;
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    initTheme();
    bindEvents();
    wsConnect();

    // Restore tab from URL hash
    const hash = location.hash.replace('#', '');
    const validTabs = Object.keys(el.tabs);
    if (hash && validTabs.includes(hash)) {
      switchTab(hash, false);
    }

    // Listen for back/forward navigation
    window.addEventListener('hashchange', () => {
      const h = location.hash.replace('#', '');
      if (h && validTabs.includes(h)) switchTab(h, false);
    });

    // Load initial data in parallel
    try {
      await Promise.allSettled([loadKnowledge(), loadEmbeddingStats()]);
    } catch {
      // individual loaders handle their own errors
    }

    // Hide loading overlay after a short delay if ws hasn't connected
    setTimeout(() => {
      el.loadingOverlay.classList.add('hidden');
    }, 5000);
  }

  // Panel resize handle (drag to resize like agent-tasks)
  function initPanelResize() {
    const panel = document.getElementById('side-panel');
    if (!panel) return;
    const handle = document.createElement('div');
    handle.className = 'panel-resize-handle';
    panel.appendChild(handle);

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const dx = startX - e.clientX;
      const newWidth = Math.max(320, Math.min(startWidth + dx, window.innerWidth * 0.8));
      panel.style.width = newWidth + 'px';
      panel.style.minWidth = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  // Theme sync from parent (agent-desk) via executeJavaScript
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'theme-sync') return;
    const colors = event.data.colors;
    if (!colors) return;

    // Contrast enforcement: ensure text is readable against background
    function ensureContrast(bg, fg) {
      const lum = (hex) => {
        if (!hex || hex.charAt(0) !== '#' || hex.length < 7) return 0.5;
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const bgLum = lum(bg);
      return bgLum < 0.5 ? (lum(fg) < 0.4 ? '#e0e0e0' : fg) : lum(fg) > 0.6 ? '#333333' : fg;
    }

    const root = document.documentElement;
    const bgColor = colors.bg || null;

    // Core backgrounds
    if (colors.bg) root.style.setProperty('--bg', colors.bg);
    if (colors.bgSurface) root.style.setProperty('--bg-surface', colors.bgSurface);
    if (colors.bgElevated) root.style.setProperty('--bg-elevated', colors.bgElevated);
    if (colors.bgHover) root.style.setProperty('--bg-hover', colors.bgHover);
    if (colors.bgInset) root.style.setProperty('--bg-inset', colors.bgInset);

    // Borders
    if (colors.border) root.style.setProperty('--border', colors.border);
    if (colors.borderLight) root.style.setProperty('--border-light', colors.borderLight);

    // Text colors (with contrast enforcement)
    if (colors.text)
      root.style.setProperty(
        '--text',
        bgColor ? ensureContrast(bgColor, colors.text) : colors.text,
      );
    if (colors.textSecondary)
      root.style.setProperty(
        '--text-secondary',
        bgColor ? ensureContrast(bgColor, colors.textSecondary) : colors.textSecondary,
      );
    if (colors.textMuted)
      root.style.setProperty(
        '--text-muted',
        bgColor ? ensureContrast(bgColor, colors.textMuted) : colors.textMuted,
      );
    if (colors.textDim)
      root.style.setProperty(
        '--text-dim',
        bgColor ? ensureContrast(bgColor, colors.textDim) : colors.textDim,
      );

    // Accent colors
    if (colors.accent) root.style.setProperty('--accent', colors.accent);
    if (colors.accentHover) root.style.setProperty('--accent-hover', colors.accentHover);
    if (colors.accentDim) root.style.setProperty('--accent-dim', colors.accentDim);
    if (colors.accentSolid) root.style.setProperty('--accent-solid', colors.accentSolid);
    if (colors.accentGlow) root.style.setProperty('--accent-glow', colors.accentGlow);

    // Semantic colors
    if (colors.green) root.style.setProperty('--green', colors.green);
    if (colors.greenDim) root.style.setProperty('--green-dim', colors.greenDim);
    if (colors.yellow) root.style.setProperty('--yellow', colors.yellow);
    if (colors.yellowDim) root.style.setProperty('--yellow-dim', colors.yellowDim);
    if (colors.orange) root.style.setProperty('--orange', colors.orange);
    if (colors.orangeDim) root.style.setProperty('--orange-dim', colors.orangeDim);
    if (colors.red) root.style.setProperty('--red', colors.red);
    if (colors.redDim) root.style.setProperty('--red-dim', colors.redDim);
    if (colors.purple) root.style.setProperty('--purple', colors.purple);
    if (colors.purpleDim) root.style.setProperty('--purple-dim', colors.purpleDim);
    if (colors.blue) root.style.setProperty('--blue', colors.blue);
    if (colors.blueDim) root.style.setProperty('--blue-dim', colors.blueDim);

    // Focus ring
    if (colors.focusRing) root.style.setProperty('--focus-ring', colors.focusRing);

    // Shadows (adapt for dark/light)
    if (colors.isDark !== undefined) {
      if (colors.isDark) {
        root.style.setProperty(
          '--shadow-1',
          '0px 1px 2px 0px rgba(0,0,0,0.6), 0px 1px 3px 1px rgba(0,0,0,0.3)',
        );
        root.style.setProperty(
          '--shadow-2',
          '0px 1px 2px 0px rgba(0,0,0,0.6), 0px 2px 6px 2px rgba(0,0,0,0.3)',
        );
        root.style.setProperty(
          '--shadow-3',
          '0px 1px 3px 0px rgba(0,0,0,0.6), 0px 4px 8px 3px rgba(0,0,0,0.3)',
        );
        root.style.setProperty(
          '--shadow-hover',
          '0px 2px 4px 0px rgba(0,0,0,0.5), 0px 4px 12px 4px rgba(0,0,0,0.3)',
        );
        root.style.setProperty(
          '--shadow-panel',
          '-2px 0px 8px 0px rgba(0,0,0,0.6), -4px 0px 16px 2px rgba(0,0,0,0.3)',
        );
      } else {
        root.style.setProperty(
          '--shadow-1',
          '0px 1px 2px 0px rgba(0,0,0,0.3), 0px 1px 3px 1px rgba(0,0,0,0.15)',
        );
        root.style.setProperty(
          '--shadow-2',
          '0px 1px 2px 0px rgba(0,0,0,0.3), 0px 2px 6px 2px rgba(0,0,0,0.15)',
        );
        root.style.setProperty(
          '--shadow-3',
          '0px 1px 3px 0px rgba(0,0,0,0.3), 0px 4px 8px 3px rgba(0,0,0,0.15)',
        );
        root.style.setProperty(
          '--shadow-hover',
          '0px 2px 4px 0px rgba(0,0,0,0.25), 0px 4px 12px 4px rgba(0,0,0,0.15)',
        );
        root.style.setProperty(
          '--shadow-panel',
          '-2px 0px 8px 0px rgba(0,0,0,0.3), -4px 0px 16px 2px rgba(0,0,0,0.15)',
        );
      }
    }

    // Apply theme attribute and hide the toggle (agent-desk controls the theme)
    if (colors.isDark !== undefined) {
      const theme = colors.isDark ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('agent-knowledge-theme', theme);
      const icon = el.themeToggle.querySelector('.theme-icon');
      if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
    }

    // Hide the local theme toggle — agent-desk controls the theme
    if (el.themeToggle) el.themeToggle.style.display = 'none';
  });

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      initPanelResize();
    });
  } else {
    init();
    initPanelResize();
  }
})();
