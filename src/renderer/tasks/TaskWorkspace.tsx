import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleDot, ListTodo, Plus, Trash2 } from 'lucide-react';
import type { TaskItem, TaskStatus } from '../../shared/types';

const COLUMNS: Array<{ status: TaskStatus; label: string; hint: string }> = [
  { status: 'todo', label: 'To do', hint: 'Ready when you are' },
  { status: 'in_progress', label: 'In progress', hint: 'What you are working on' },
  { status: 'done', label: 'Done', hint: 'Completed today' },
];

function localDate(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function moveDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function dateHeading(value: string): { eyebrow: string; heading: string } {
  const today = localDate();
  const relative = value === today ? 'Today' : value === moveDate(today, -1) ? 'Yesterday' : value === moveDate(today, 1) ? 'Tomorrow' : 'Daily plan';
  return { eyebrow: relative, heading: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${value}T12:00:00`)) };
}

function TaskRow({ task, onUpdate, onRemove }: { task: TaskItem; onUpdate: (id: string, patch: { title?: string; taskDate?: string; status?: TaskStatus }) => Promise<void>; onRemove: (task: TaskItem) => Promise<void> }) {
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.title]);
  const saveTitle = () => {
    const next = title.trim();
    if (!next) setTitle(task.title);
    else if (next !== task.title) void onUpdate(task.id, { title: next });
  };
  return <article className={`task-item task-${task.status}`}>
    <button className="task-complete-button" title={task.status === 'done' ? 'Mark as to do' : 'Mark as done'} aria-label={task.status === 'done' ? 'Mark as to do' : 'Mark as done'} onClick={() => void onUpdate(task.id, { status: task.status === 'done' ? 'todo' : 'done' })}>
      {task.status === 'done' ? <Check size={14} /> : task.status === 'in_progress' ? <CircleDot size={15} /> : <Circle size={15} />}
    </button>
    <input className="task-title-input" aria-label="Task title" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={saveTitle} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setTitle(task.title); event.currentTarget.blur(); } }} />
    <div className="task-item-actions">
      <select aria-label={`Status for ${task.title}`} value={task.status} onChange={(event) => void onUpdate(task.id, { status: event.target.value as TaskStatus })}>
        <option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option>
      </select>
      <input type="date" aria-label={`Date for ${task.title}`} value={task.taskDate} onChange={(event) => void onUpdate(task.id, { taskDate: event.target.value })} />
      <button className="task-delete-button" title="Delete task" aria-label={`Delete ${task.title}`} onClick={() => void onRemove(task)}><Trash2 size={14} /></button>
    </div>
  </article>;
}

export function TaskWorkspace() {
  const [selectedDate, setSelectedDate] = useState(localDate);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const heading = dateHeading(selectedDate);
  const today = localDate();
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setTasks(await window.notes.tasks.list(selectedDate)); }
    catch { setError('Tasks could not be loaded. Please try again.'); }
    finally { setLoading(false); }
  }, [selectedDate]);
  useEffect(() => { void load(); }, [load]);
  const grouped = useMemo(() => Object.fromEntries(COLUMNS.map((column) => [column.status, tasks.filter((task) => task.status === column.status)])) as Record<TaskStatus, TaskItem[]>, [tasks]);
  const complete = grouped.done.length;
  const progress = tasks.length ? Math.round((complete / tasks.length) * 100) : 0;
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = title.trim();
    if (!next || saving) return;
    setSaving(true); setError('');
    try { const created = await window.notes.tasks.create(next, selectedDate); setTasks((before) => [...before, created]); setTitle(''); }
    catch { setError('The task could not be created.'); }
    finally { setSaving(false); }
  };
  const update = async (id: string, patch: { title?: string; taskDate?: string; status?: TaskStatus }) => {
    setError('');
    try {
      const updated = await window.notes.tasks.update(id, patch);
      setTasks((before) => updated.taskDate === selectedDate ? before.map((task) => task.id === id ? updated : task) : before.filter((task) => task.id !== id));
    } catch { setError('The task could not be updated.'); }
  };
  const remove = async (task: TaskItem) => {
    if (!window.confirm(`Delete “${task.title}”?`)) return;
    try { await window.notes.tasks.remove(task.id); setTasks((before) => before.filter((item) => item.id !== task.id)); }
    catch { setError('The task could not be deleted.'); }
  };
  return <main className="tasks-workspace">
    <section className="tasks-header">
      <div className="tasks-heading"><span><ListTodo size={20} /></span><div><small>{heading.eyebrow}</small><h1>{heading.heading}</h1><p>Plan the day, keep work moving, and finish with a clear view of what you accomplished.</p></div></div>
      <div className="task-date-navigation">
        <button title="Previous day" aria-label="Previous day" onClick={() => setSelectedDate((value) => moveDate(value, -1))}><ChevronLeft size={17} /></button>
        <button className="today-button" disabled={selectedDate === today} onClick={() => setSelectedDate(today)}>Today</button>
        <label title="Choose date"><CalendarDays size={15} /><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
        <button title="Next day" aria-label="Next day" onClick={() => setSelectedDate((value) => moveDate(value, 1))}><ChevronRight size={17} /></button>
      </div>
    </section>
    <section className="tasks-summary" aria-label="Daily progress">
      <div><span className="summary-icon total"><ListTodo size={16} /></span><p><strong>{tasks.length}</strong><small>Total tasks</small></p></div>
      <div><span className="summary-icon active"><CircleDot size={16} /></span><p><strong>{grouped.in_progress.length}</strong><small>In progress</small></p></div>
      <div><span className="summary-icon complete"><CheckCircle2 size={16} /></span><p><strong>{complete}</strong><small>Completed</small></p></div>
      <div className="progress-summary"><p><strong>{progress}%</strong><small>Daily progress</small></p><span><i style={{ width: `${progress}%` }} /></span></div>
    </section>
    <form className="task-quick-add" onSubmit={(event) => void create(event)}><span><Plus size={17} /></span><input autoComplete="off" placeholder={`Add a task for ${selectedDate === today ? 'today' : heading.heading}…`} value={title} onChange={(event) => setTitle(event.target.value)} /><button type="submit" disabled={!title.trim() || saving}>{saving ? 'Adding…' : 'Add task'}</button></form>
    {error && <p className="tasks-error">{error}</p>}
    <section className="task-board">
      {COLUMNS.map((column) => <section className={`task-column column-${column.status}`} key={column.status}>
        <header><span>{column.status === 'todo' ? <Circle size={16} /> : column.status === 'in_progress' ? <CircleDot size={16} /> : <CheckCircle2 size={16} />}</span><div><strong>{column.label}</strong><small>{column.hint}</small></div><b>{grouped[column.status].length}</b></header>
        <div className="task-list">{loading ? <p className="task-empty">Loading…</p> : grouped[column.status].length ? grouped[column.status].map((task) => <TaskRow key={task.id} task={task} onUpdate={update} onRemove={remove} />) : <p className="task-empty">{column.status === 'done' ? 'Completed tasks will collect here.' : 'Nothing here yet.'}</p>}</div>
      </section>)}
    </section>
  </main>;
}
