/* agent-knowledge — shared UI utilities */
(function () {
  'use strict';

  window.Knowledge = window.Knowledge || {};
  window.Knowledge._baseUrl = '';
  window.Knowledge._wsUrl = null;

  // ── DOM helper ──────────────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);

  // ── Escape HTML ─────────────────────────────────────────────────────────────

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Debounce ────────────────────────────────────────────────────────────────

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // ── Relative time ───────────────────────────────────────────────────────────

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

  // ── Markdown rendering ──────────────────────────────────────────────────────

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

  // ── Highlight search excerpts ───────────────────────────────────────────────

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

  // ── Score bar rendering ─────────────────────────────────────────────────────

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

  // ── Toast notifications ─────────────────────────────────────────────────────

  function toast(msg, type = 'info', duration = 4000) {
    const container = $('toast-container');
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const icons = { info: 'info', success: 'check_circle', error: 'error', warning: 'warning' };
    t.innerHTML = `<span class="material-symbols-outlined toast-icon">${icons[type] || 'info'}</span>
      <span class="toast-msg">${esc(msg)}</span>`;
    container.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      t.addEventListener('transitionend', () => t.remove());
    }, duration);
  }

  // ── API helper ──────────────────────────────────────────────────────────────

  async function api(path) {
    const res = await fetch(`${window.Knowledge._baseUrl}/api${path}`);
    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
    return res.json();
  }

  // ── Theme ───────────────────────────────────────────────────────────────────

  function initTheme() {
    const saved = localStorage.getItem('agent-knowledge-theme');
    const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('agent-knowledge-theme', theme);
    const icon = $('theme-toggle')?.querySelector('.theme-icon');
    if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  // ── Strip frontmatter ───────────────────────────────────────────────────────

  function stripFrontmatter(content) {
    const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    return match ? match[1].trim() : content;
  }

  // ── Check if input is focused ───────────────────────────────────────────────

  function isInputFocused() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || active.isContentEditable;
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  Object.assign(window.Knowledge, {
    $,
    esc,
    debounce,
    relativeTime,
    renderMd,
    highlightExcerpt,
    formatScore,
    toast,
    api,
    initTheme,
    applyTheme,
    toggleTheme,
    stripFrontmatter,
    isInputFocused,
  });
})();
