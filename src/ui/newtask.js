import { $, esc, longDay, STATUS } from './util.js';
import { S, hooks } from './state.js';
import { api } from './api.js';
import { createCalendar, newCalState } from './calendar.js';
import { dues } from './items.js';
import { mountConnect } from './picker.js';
import { mountEditor } from './editor.js';

/* New-task dialog. Left: title, column, connections, details. Right: due-date calendar + that day's tasks. */
export function openNewTask(pre = {}) {
  const dlg = $('#dlg'), links = [];
  let due = pre.due || '';
  dlg.className = 'nt';
  dlg.innerHTML = `<div class="nt-l"><div class="nt-body"><h2>New task</h2><p class="sub">Saved as a note in your vault. Connections become links in Obsidian's graph.</p>
      <label for="nt-t">Title</label><input id="nt-t" autocomplete="off">
      <label for="nt-s">Column</label><select id="nt-s">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <label>Connect to notes</label><div id="nt-c"></div>
      <label>Details</label><div id="nt-d"></div></div>
      <div class="nt-f"><p class="err" id="nt-err" role="alert"></p>
        <div class="foot"><button type="button" class="ghost" id="nt-x">Cancel</button><button type="button" class="primary" id="nt-ok">Create task</button></div></div></div>
    <div class="nt-r"><label>Due date</label><div id="nt-cal"></div><div id="nt-day"></div></div>`;

  mountConnect($('#nt-c'), links, dlg);
  const ed = mountEditor($('#nt-d'));
  const cal = createCalendar($('#nt-cal'), newCalState(due || undefined), {
    mini: true, selected: due, tasks: () => dues('all'), onDay: k => { due = k; day(); },
  });
  cal.render();

  function day() {
    const ts = dues('all').filter(t => t.due === due);
    $('#nt-day').innerHTML = !due ? '<p class="empty">No due date. Pick a day on the calendar.</p>'
      : `<div class="dayh"><b>${longDay(due)}</b><button type="button" class="link" id="nt-clr">Clear</button></div>`
        + (ts.length ? ts.map(t => `<div class="dt ${esc(t.status)}${t.source === 'canvas' ? ' is-canvas' : ''}"><i></i><span class="ell">${esc(t.title)}</span><small>${STATUS[t.status] || ''}</small></div>`).join('') : '<p class="empty">No tasks on this day</p>');
    const clr = $('#nt-clr'); if (clr) clr.onclick = () => { due = ''; cal.select(''); day(); };
  }
  day();

  $('#nt-x').onclick = () => dlg.close();
  $('#nt-ok').onclick = async () => {
    const title = $('#nt-t').value.trim(), btn = $('#nt-ok');
    if (!title) { $('#nt-t').focus(); $('#nt-err').textContent = 'Give the task a title.'; return; }
    btn.disabled = true;
    try {
      await api('/api/tasks', { title, due: due || null, status: $('#nt-s').value, links: links.map(l => l.title), details: ed.get() });
      dlg.close(); hooks.reload();
    } catch (e) { $('#nt-err').textContent = e.message; btn.disabled = false; }
  };
  dlg.showModal();
  $('#nt-t').focus();
}
