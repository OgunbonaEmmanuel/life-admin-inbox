import { useEffect, useState, type FormEvent } from 'react';
import {
  Download,
  FileText,
  ShieldCheck,
  AlertCircle,
  Pencil,
  Trash2,
  Check,
  RotateCcw,
  Archive,
} from 'lucide-react';
import type { Task, Document } from '../shared/types';
import { Modal, CategoryIcon, categoryLabel, formatDate } from './components';
import { api, download, request } from './api';
export default function SourcePanel({
  task,
  document,
  onClose,
  onChanged,
  notify,
}: {
  task: Task;
  document: Document | undefined;
  onClose: () => void;
  onChanged: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [editing, setEditing] = useState(false),
    [form, setForm] = useState(task),
    [busy, setBusy] = useState(false),
    [verified, setVerified] = useState(false),
    [preview, setPreview] = useState('');
  const source = document?.sources.find((s) => s.id === task.sourceId);
  useEffect(() => {
    if (!document?.mime.startsWith('image/')) return;
    let active = true,
      url = '';
    request(`/documents/${document.id}/download`)
      .then((r) => r.blob())
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (active) setPreview(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [document?.id, document?.mime]);
  async function mutate(patch: unknown, method = 'PATCH') {
    setBusy(true);
    try {
      await api(`/tasks/${task.id}`, patch, method);
      await onChanged();
      onClose();
      notify(
        method === 'DELETE'
          ? 'Task deleted. Its reminders are cancelled.'
          : 'Task updated. Future reminders have been refreshed.',
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function save(e: FormEvent) {
    e.preventDefault();
    void mutate({
      title: form.title,
      category: form.category,
      due: form.due,
      amount: form.amount || null,
      currency: form.currency || null,
      organization: form.organization || null,
      attention: verified ? [] : form.attention,
    });
  }
  return (
    <Modal title={editing ? 'Edit your task' : 'Behind the task'} onClose={onClose} wide>
      <div className="source-title">
        <CategoryIcon category={task.category} />
        <div>
          <span className="eyebrow">
            {categoryLabel[task.category]} ·{' '}
            {task.synthetic
              ? 'SYNTHETIC EXAMPLE'
              : task.edited
                ? 'EDITED BY YOU'
                : 'AUTO-EXTRACTED'}
          </span>
          <h3>{task.title}</h3>
        </div>
      </div>
      {editing ? (
        <form onSubmit={save} className="edit-form">
          <label>
            Task title
            <input
              required
              maxLength={160}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label>
              Category
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as Task['category'] })}
              >
                {Object.entries(categoryLabel).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Organization or person
              <input
                value={form.organization || ''}
                onChange={(e) => setForm({ ...form, organization: e.target.value })}
              />
            </label>
            <label>
              Date type
              <select
                value={form.due.kind}
                onChange={(e) =>
                  setForm({
                    ...form,
                    due: {
                      kind: e.target.value as Task['due']['kind'],
                      date: e.target.value === 'none' ? null : form.due.date,
                      time: null,
                      timezone: null,
                    },
                  })
                }
              >
                <option value="none">No confirmed date</option>
                <option value="date">Date only</option>
                <option value="datetime">Date and time</option>
              </select>
            </label>
            {form.due.kind !== 'none' && (
              <label>
                Confirmed date
                <input
                  type="date"
                  required
                  value={form.due.date || ''}
                  onChange={(e) => setForm({ ...form, due: { ...form.due, date: e.target.value } })}
                />
              </label>
            )}
            {form.due.kind === 'datetime' && (
              <>
                <label>
                  Appointment time
                  <input
                    type="time"
                    required
                    value={form.due.time || ''}
                    onChange={(e) =>
                      setForm({ ...form, due: { ...form.due, time: e.target.value } })
                    }
                  />
                </label>
                <label>
                  Appointment timezone
                  <input
                    required
                    placeholder="e.g. Africa/Lagos"
                    value={form.due.timezone || ''}
                    onChange={(e) =>
                      setForm({ ...form, due: { ...form.due, timezone: e.target.value } })
                    }
                  />
                </label>
              </>
            )}
            {form.category === 'payment' && (
              <>
                <label>
                  Amount
                  <input
                    inputMode="decimal"
                    value={form.amount || ''}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </label>
                <label>
                  Currency (ISO code)
                  <input
                    placeholder="e.g. NGN"
                    maxLength={3}
                    value={form.currency || ''}
                    onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  />
                </label>
              </>
            )}
          </div>
          {task.attention.length > 0 && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
              />{' '}
              I have checked these details and resolved the attention flags.
            </label>
          )}
          <p className="fine-print">
            No confirmed date means no scheduled reminders. Your edits will survive extraction
            retries.
          </p>
          <div className="button-row">
            <button className="button primary" disabled={busy}>
              Save changes
            </button>
            <button type="button" className="button secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="task-details">
            <div>
              <span>WHEN</span>
              <strong>
                {formatDate(task.due.date)}
                {task.due.time ? ` · ${task.due.time}` : ''}
              </strong>
              <small>{task.due.timezone || 'Your timezone for date-only reminders'}</small>
            </div>
            {task.amount && (
              <div>
                <span>AMOUNT</span>
                <strong>
                  {task.currency || 'Currency unspecified'} {task.amount}
                </strong>
              </div>
            )}
          </div>
          {task.attention.length > 0 && (
            <div className="attention-box">
              <AlertCircle size={18} />
              <div>
                <strong>A detail needs your attention</strong>
                {task.attention.map((a, i) => (
                  <p key={i}>{a}</p>
                ))}
                <small>Reminders are paused until these details are resolved.</small>
              </div>
            </div>
          )}
          <div className="evidence-heading">
            <FileText size={17} />
            <h4>From the original</h4>
            <span>{source?.label || 'Source unavailable'}</span>
          </div>
          <blockquote className="evidence">“{task.excerpt}”</blockquote>
          <p className="fine-print">
            <ShieldCheck size={14} />
            {task.synthetic
              ? 'Prewritten synthetic example; no model extraction was performed.'
              : source?.ocr
                ? 'Excerpt matched to AI-transcribed image text, which may contain OCR errors.'
                : 'Excerpt matched to extracted document text.'}{' '}
            Matching evidence does not guarantee a correct interpretation.
          </p>
          {document && (
            <button
              className="source-file"
              onClick={() =>
                void download(document.id, document.name).catch((e) => notify(e.message))
              }
            >
              <FileText size={20} />
              <span>
                <strong>{document.name}</strong>
                <small>{source?.label} · Private original</small>
              </span>
              <Download size={17} />
            </button>
          )}
          {preview && (
            <details className="preview-details">
              <summary>Preview source image</summary>
              <img src={preview} alt={`Source document: ${document?.name}`} />
            </details>
          )}
          <div className="source-actions">
            <button className="button primary" onClick={() => setEditing(true)}>
              <Pencil size={16} /> Edit task
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void mutate({ state: task.state === 'completed' ? 'open' : 'completed' })
              }
            >
              {task.state === 'completed' ? <RotateCcw size={16} /> : <Check size={16} />}{' '}
              {task.state === 'completed' ? 'Reopen' : 'Complete'}
            </button>
            <button
              className="button text-button"
              disabled={busy}
              onClick={() =>
                void mutate({ state: task.state === 'dismissed' ? 'open' : 'dismissed' })
              }
            >
              <Archive size={15} /> {task.state === 'dismissed' ? 'Reopen' : 'Dismiss'}
            </button>
            <button
              className="icon-button danger"
              disabled={busy}
              aria-label="Delete task"
              onClick={() => void mutate({}, 'DELETE')}
            >
              <Trash2 size={17} />
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
