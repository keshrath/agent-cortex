/* agent-knowledge — search tab rendering */
(function () {
  'use strict';

  const K = window.Knowledge;

  // ── Create debounced search ───────────────────────────────────────────────

  function createSearch(state, el) {
    return K.debounce(async () => {
      const q = state.search.query.trim();
      if (!q) {
        state.search.results = [];
        renderSearchResults(state, el);
        return;
      }
      state.search.loading = true;
      renderSearchResults(state, el);
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
        const data = await K.api(endpoint);
        state.search.results = Array.isArray(data) ? data : data.results || [];
      } catch (err) {
        K.toast(`Search failed: ${err.message}`, 'error');
        state.search.results = [];
      }
      state.search.loading = false;
      renderSearchResults(state, el);
    }, 300);
  }

  // ── Render search results ─────────────────────────────────────────────────

  function renderSearchResults(state, el) {
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
        const time = K.relativeTime(r.timestamp || r.date);
        const roleIcon = role === 'user' ? 'person' : role === 'assistant' ? 'smart_toy' : 'chat';

        return `<div class="result-item" data-session-id="${K.esc(sessionId)}" data-excerpt="${K.esc(excerpt)}" tabindex="0" role="button">
        <div class="result-meta">
          <span class="role-badge" data-role="${K.esc(role)}"><span class="material-symbols-outlined" style="font-size:12px">${roleIcon}</span> ${K.esc(role)}</span>
          ${project ? `<span class="result-project">${K.esc(project)}</span>` : ''}
          ${time ? `<span class="result-date">${time}</span>` : ''}
          ${score != null ? `<span class="score-container">${K.formatScore(score, meta)}</span>` : ''}
        </div>
        <div class="result-excerpt">${K.highlightExcerpt(excerpt, query)}</div>
      </div>`;
      })
      .join('');

    el.searchResults.querySelectorAll('.result-item').forEach((card) => {
      card.addEventListener('click', () =>
        K.openSessionPanel(card.dataset.sessionId, card.dataset.excerpt),
      );
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') K.openSessionPanel(card.dataset.sessionId, card.dataset.excerpt);
      });
    });
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  Object.assign(K, {
    createSearch,
    renderSearchResults,
  });
})();
