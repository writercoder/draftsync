/**
 * Shared activity-feed renderer — one implementation of the newsfeed
 * vocabulary (icons, day grouping, object-first phrasing) used by the
 * dashboard and collection pages. Exposed as window.dsFeed.
 */
(() => {
  const KIND_ICON = {
    file_edited: 'edit',
    chapter_created: 'doc-plus',
    edition_created: 'layers',
    review_sent: 'plane',
    review_received: 'inbox',
    task_created: 'square',
    task_completed: 'square-check',
    ai_event: 'sparkle'
  };

  const CAT = {
    file_edited: 'files',
    chapter_created: 'files',
    edition_created: 'files',
    review_sent: 'reviews',
    review_received: 'reviews',
    task_created: 'tasks',
    task_completed: 'tasks',
    ai_event: 'ai'
  };

  const dayLabel = iso => {
    const day = String(iso || '').slice(0, 10);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 86400e3).toISOString().slice(0, 10);
    if (day === today) return 'Today';
    if (day === yesterday) return 'Yesterday';
    return new Date(day + 'T12:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });
  };

  const streamText = row => {
    const d = row.data || {};
    switch (row.kind) {
      case 'file_edited':
        return `${row.chapterTitle || d.file} edited +${d.linesAdded} −${d.linesRemoved}`;
      case 'chapter_created':
        return `${d.title} ${d.imported ? 'imported' : 'added'}`;
      case 'edition_created':
        return `edition ${d.name} created`;
      case 'review_sent':
        return `to ${d.reviewer}` + (row.chapterTitle ? ` — ${row.chapterTitle}` : '');
      case 'review_received':
        return `from ${d.reviewer}` + (row.chapterTitle ? ` — ${row.chapterTitle}` : '');
      case 'task_created':
      case 'task_completed':
        return d.text;
      case 'ai_event':
        return `${d.purpose} — ${d.provider}` + (row.chapterTitle ? ` · ${row.chapterTitle}` : '');
      default:
        return row.kind;
    }
  };

  /**
   * Render stream rows into a container: day headers, kind icons, unread
   * highlight above an EARLIER divider, optional project links.
   */
  const renderStream = (list, stream, { seenAt = null, showProject = true } = {}) => {
    list.innerHTML = '';
    if (stream.length === 0) {
      list.innerHTML = '<div class="st-item"><span class="what">Nothing here yet.</span></div>';
      return;
    }
    let currentDay = null;
    let dividerPlaced = false;
    const hasNew = seenAt && stream.some(r => String(r.at || '') > seenAt);
    for (const row of stream) {
      const isNew = seenAt && String(row.at || '') > seenAt;
      if (!isNew && !dividerPlaced && hasNew) {
        const divider = document.createElement('div');
        divider.className = 'st-new-divider';
        divider.textContent = 'earlier';
        list.appendChild(divider);
        dividerPlaced = true;
      }
      const day = dayLabel(row.at);
      if (day !== currentDay) {
        currentDay = day;
        const head = document.createElement('div');
        head.className = 'st-day';
        head.textContent = day;
        list.appendChild(head);
      }
      const item = document.createElement('div');
      item.className = 'st-item' + (isNew ? ' new' : '');
      item.title = row.kind.replace(/_/g, ' ');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'ic' + (row.kind === 'ai_event' ? ' ai' : ''));
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `/assets/icons.svg#${KIND_ICON[row.kind] || 'pulse'}`);
      icon.appendChild(use);
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = streamText(row);
      if (row.kind === 'ai_event') {
        const mark = document.createElement('span');
        if (row.data.purpose === 'prose-suggestion' && !row.data.justification) {
          mark.className = 'warn';
          mark.textContent = ' ⚠';
        } else if (row.data.justification) {
          mark.className = 'ok';
          mark.textContent = ' ✓';
        }
        what.appendChild(mark);
      }
      if (showProject && row.projectName) {
        const proj = document.createElement('a');
        proj.className = 'proj';
        proj.href = `/p/${row.project_id}`;
        proj.textContent = row.projectName;
        what.appendChild(document.createTextNode(' '));
        what.appendChild(proj);
      }
      item.append(icon, what);
      list.appendChild(item);
    }
  };

  window.dsFeed = { KIND_ICON, CAT, dayLabel, streamText, renderStream };
})();
