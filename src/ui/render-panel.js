/* agent-knowledge — side panel rendering */
(function () {
  'use strict';

  const K = window.Knowledge;

  // ── Open / close panel ────────────────────────────────────────────────────

  function openPanel(type, data) {
    const state = K._state;
    const el = K._el;
    state.panel = { open: true, type, data };
    el.sidePanel.hidden = false;
    requestAnimationFrame(() => el.sidePanel.classList.add('open'));
    el.contentWrapper.classList.add('panel-visible');

    if (type === 'knowledge') {
      renderKnowledgePanel(data, el);
    } else if (type === 'session') {
      renderSessionPanel(data, el);
    } else if (type === 'consolidate') {
      renderConsolidatePanel(data, el);
    } else if (type === 'reflect') {
      renderReflectPanel(data, el);
    }
  }

  function closePanel() {
    const state = K._state;
    const el = K._el;
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

  // ── Knowledge panel ───────────────────────────────────────────────────────

  function renderKnowledgePanel(data, el) {
    el.panelTitle.innerHTML = `<span class="material-symbols-outlined panel-icon">article</span>${K.esc(data.title)}`;
    const meta = data.meta || {};
    const entry = meta.entry || meta;
    const category = entry.category || meta.category || '';
    const tags = entry.tags || meta.tags || [];
    const updated = entry.updated || meta.updated || '';
    const maturity = meta.maturity || 'candidate';
    const accessCount = meta.access_count || 0;

    let metaHtml = '<div class="panel-meta">';
    if (category)
      metaHtml += `<span class="card-category" data-cat="${K.esc(category)}">${K.esc(category)}</span>`;
    metaHtml += `<span class="maturity-badge" data-maturity="${K.esc(maturity)}">${K.esc(maturity)}${accessCount > 0 ? ` <span class="maturity-reads">&middot; ${accessCount} reads</span>` : ''}</span>`;
    if (tags.length)
      metaHtml += tags.map((t) => `<span class="card-tag">${K.esc(t)}</span>`).join('');
    if (updated) metaHtml += `<span class="panel-meta-date">${K.esc(updated)}</span>`;
    metaHtml += '</div>';

    const body = K.stripFrontmatter(data.content);
    let html = metaHtml + `<div class="prose">${K.renderMd(body)}</div>`;

    // Related entries section
    const links = data.links || [];
    if (links.length > 0) {
      const entryPath = data.entryPath || '';
      html += '<div class="panel-section related-section">';
      html +=
        '<h4 class="panel-section-title"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;margin-right:4px">hub</span>Related</h4>';
      html += '<div class="related-entries">';
      links.forEach((link) => {
        const linkedPath = link.source === entryPath ? link.target : link.source;
        const relType = link.rel_type || 'related_to';
        const strength = link.strength != null ? link.strength : 0.5;
        const linkedTitle = linkedPath.split('/').pop().replace(/\.md$/, '').replace(/[-_]/g, ' ');
        html += `<div class="related-entry" data-path="${K.esc(linkedPath)}" tabindex="0" role="button">
          <span class="rel-type-pill" data-rel="${K.esc(relType)}">${K.esc(relType.replace(/_/g, ' '))}</span>
          <span class="related-entry-title">${K.esc(linkedTitle)}</span>
          <span class="related-entry-strength" title="Strength: ${strength.toFixed(2)}">${(strength * 100).toFixed(0)}%</span>
        </div>`;
      });
      html += '</div></div>';
    }

    el.panelBody.innerHTML = html;

    // Bind click handlers on related entries
    el.panelBody.querySelectorAll('.related-entry').forEach((entryEl) => {
      entryEl.addEventListener('click', () => K.openKnowledgePanel(entryEl.dataset.path));
      entryEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') K.openKnowledgePanel(entryEl.dataset.path);
      });
    });
  }

  // ── Session panel ─────────────────────────────────────────────────────────

  function renderSessionPanel(data, el) {
    const s = data.session || {};
    const summary = data.summary;
    const id = data.sessionId || s.id || '';
    const meta = s.meta || s;

    el.panelTitle.innerHTML = `<span class="material-symbols-outlined panel-icon">terminal</span>Session ${K.esc(id.slice(0, 8))}`;

    let html = '<div class="panel-meta">';
    if (meta.cwd)
      html += `<span class="panel-meta-item"><span class="material-symbols-outlined" style="font-size:14px">folder</span>${K.esc(meta.cwd)}</span>`;
    if (meta.branch)
      html += `<span class="panel-meta-item"><span class="material-symbols-outlined" style="font-size:14px">alt_route</span>${K.esc(meta.branch)}</span>`;
    if (meta.startTime && meta.startTime !== 'unknown')
      html += `<span class="panel-meta-item"><span class="material-symbols-outlined" style="font-size:14px">schedule</span>${new Date(meta.startTime).toLocaleString()}</span>`;
    if (meta.messageCount)
      html += `<span class="panel-meta-item"><span class="material-symbols-outlined" style="font-size:14px">chat</span>${meta.messageCount} messages</span>`;
    html += '</div>';

    if (summary && summary.topics && summary.topics.length) {
      html +=
        '<div class="panel-section"><h4 class="panel-section-title">Topics</h4><ul class="panel-topics">';
      summary.topics.slice(0, 8).forEach((t) => {
        html += `<li>${K.esc(t.content)}</li>`;
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
        const time = m.timestamp ? K.relativeTime(m.timestamp) : '';

        html += `<div class="${cls}">
          <div class="chat-msg-role"><span class="material-symbols-outlined" style="font-size:14px">${roleIcon}</span> ${K.esc(role)} ${time ? `<span class="chat-msg-time">${time}</span>` : ''}</div>
          <div>${isUser ? K.esc(truncated) : K.renderMd(truncated)}</div>
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
        // Extract meaningful words from excerpt (strip JSON, XML, tool output noise)
        const raw = data.searchExcerpt.replace(/\s+/g, ' ').trim().toLowerCase();
        const cleaned = raw
          .replace(/\{[^}]*\}/g, ' ') // strip JSON objects
          .replace(/<[^>]*>/g, ' ') // strip XML/HTML tags
          .replace(/[\\/"{}[\]]/g, ' ') // strip special chars
          .replace(/tool_use_id|tool_result|content|type|text/g, ' ') // strip common JSON keys
          .replace(/toolu_[a-z0-9]+/g, ' ') // strip tool IDs
          .replace(/\b[a-f0-9]{8,}\b/g, ' '); // strip hex strings
        const words = cleaned.split(/\s+/).filter((w) => w.length > 3 && !/^[0-9]+$/.test(w));

        if (words.length === 0) return;

        const msgEls = el.panelBody.querySelectorAll('.chat-msg');
        let bestMatch = null;
        let bestScore = -1;

        msgEls.forEach((msgEl) => {
          const text = msgEl.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
          // Count how many meaningful words appear in this message
          const matched = words.filter((w) => text.includes(w)).length;
          const ratio = matched / words.length;
          if (ratio > bestScore && matched >= 2) {
            bestScore = ratio;
            bestMatch = msgEl;
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

  // ── Consolidate panel ─────────────────────────────────────────────────────

  function renderConsolidatePanel(data, el) {
    el.panelTitle.innerHTML =
      '<span class="material-symbols-outlined panel-icon">content_copy</span>Duplicate Analysis';

    let html = '<div class="panel-meta">';
    html += `<span class="panel-meta-item">${data.totalEntries} entries scanned</span>`;
    html += `<span class="panel-meta-item">${data.clustersFound} cluster(s) found</span>`;
    html += `<span class="panel-meta-item">threshold: ${data.threshold}</span>`;
    html += '</div>';

    if (data.clusters.length === 0) {
      html +=
        '<div class="empty-state"><span class="material-symbols-outlined empty-icon">check_circle</span><div class="empty-text">No duplicates found</div></div>';
    } else {
      for (let i = 0; i < data.clusters.length; i++) {
        const cluster = data.clusters[i];
        html += `<div class="panel-section">`;
        html += `<h4 class="panel-section-title">Cluster ${i + 1} (${cluster.entries.length} entries)</h4>`;
        html += '<div class="related-entries">';
        for (const entry of cluster.entries) {
          const isRep = entry.path === cluster.representative;
          html += `<div class="related-entry" data-path="${K.esc(entry.path)}" tabindex="0" role="button">
            <span class="related-entry-title">${K.esc(entry.title)}${isRep ? ' <span class="maturity-badge" data-maturity="proven" style="font-size:10px">representative</span>' : ''}</span>
          </div>`;
        }
        html += '</div>';

        if (cluster.similarities.length > 0) {
          html += '<div class="score-breakdown" style="margin-top:8px">';
          for (const sim of cluster.similarities) {
            const aShort = sim.a.split('/').pop().replace(/\.md$/, '');
            const bShort = sim.b.split('/').pop().replace(/\.md$/, '');
            html += `<div style="font-size:12px;margin:2px 0">${K.esc(aShort)} &harr; ${K.esc(bShort)}: <strong>${(sim.score * 100).toFixed(0)}%</strong></div>`;
          }
          html += '</div>';
        }
        html += '</div>';
      }
    }

    el.panelBody.innerHTML = html;

    el.panelBody.querySelectorAll('.related-entry').forEach((entryEl) => {
      entryEl.addEventListener('click', () => K.openKnowledgePanel(entryEl.dataset.path));
    });
  }

  // ── Reflect panel ─────────────────────────────────────────────────────────

  function renderReflectPanel(data, el) {
    el.panelTitle.innerHTML =
      '<span class="material-symbols-outlined panel-icon">psychology</span>Reflection Analysis';

    let html = '<div class="panel-meta">';
    html += `<span class="panel-meta-item">${data.totalEntries} total entries</span>`;
    html += `<span class="panel-meta-item">${data.unconnectedEntries.length} unconnected</span>`;
    html += `<span class="panel-meta-item">${data.connectedCount} connected</span>`;
    html += '</div>';

    if (data.unconnectedEntries.length === 0) {
      html +=
        '<div class="empty-state"><span class="material-symbols-outlined empty-icon">hub</span><div class="empty-text">All entries connected</div></div>';
    } else {
      html += '<div class="panel-section">';
      html +=
        '<h4 class="panel-section-title"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;margin-right:4px">link_off</span>Unconnected Entries</h4>';
      html += '<div class="related-entries">';
      for (const entry of data.unconnectedEntries) {
        html += `<div class="related-entry" data-path="${K.esc(entry.path)}" tabindex="0" role="button">
          <span class="card-category" data-cat="${K.esc(entry.category)}" style="font-size:10px">${K.esc(entry.category)}</span>
          <span class="related-entry-title">${K.esc(entry.title)}</span>
        </div>`;
        if (entry.summary) {
          html += `<div style="font-size:12px;color:var(--text-secondary);padding:2px 8px 8px;line-height:1.4">${K.esc(entry.summary.slice(0, 150))}${entry.summary.length > 150 ? '...' : ''}</div>`;
        }
      }
      html += '</div></div>';

      html += '<div class="panel-section">';
      html +=
        '<h4 class="panel-section-title"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;margin-right:4px">smart_toy</span>Suggested Prompt</h4>';
      html += `<div class="prose" style="font-size:12px;max-height:300px;overflow-y:auto"><pre style="white-space:pre-wrap;font-size:11px">${K.esc(data.instructions)}</pre></div>`;
      html += '</div>';
    }

    el.panelBody.innerHTML = html;

    el.panelBody.querySelectorAll('.related-entry').forEach((entryEl) => {
      entryEl.addEventListener('click', () => K.openKnowledgePanel(entryEl.dataset.path));
    });
  }

  // ── Panel resize ──────────────────────────────────────────────────────────

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

  // ── Export ──────────────────────────────────────────────────────────────────

  Object.assign(K, {
    openPanel,
    closePanel,
    initPanelResize,
  });
})();
