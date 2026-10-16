import { useEffect, useRef, type ReactNode } from 'react';
import {
  X,
  ArrowUpRight,
  Wallet,
  CalendarDays,
  Flag,
  Check,
  FileText,
  AlertCircle,
} from 'lucide-react';
import type { Category, Task } from '../shared/types';
import { dueInstant } from '../shared/time';
export function Logo() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <path
            d="M7 12h26v22H7zM7 24h8l3 4h5l3-4h7M14 6h13M14 17h13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>
        life admin<span className="brand-small">INBOX</span>
      </span>
    </div>
  );
}
export const categoryLabel: Record<Category, string> = {
  payment: 'Payment',
  appointment: 'Appointment',
  deadline: 'Deadline',
};
export function CategoryIcon({ category }: { category: Category }) {
  const Icon = category === 'payment' ? Wallet : category === 'appointment' ? CalendarDays : Flag;
  return (
    <span className={`category-icon ${category}`}>
      <Icon size={21} strokeWidth={1.6} />
    </span>
  );
}
export function localDate(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function formatDate(
  date: string | null,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
) {
  return date
    ? new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(
        new Date(`${date}T12:00:00Z`),
      )
    : 'No date yet';
}
export function displayDue(task: Task, timezone: string) {
  const instant = task.due.kind === 'datetime' ? dueInstant(task.due, timezone) : null;
  const local = instant?.toZonedDateTimeISO(timezone);
  return {
    date: local?.toPlainDate().toString() || task.due.date,
    time: local?.toPlainTime().toString({ smallestUnit: 'minute' }) || task.due.time,
    instant,
  };
}
export function taskDay(task: Task, timezone: string) {
  return displayDue(task, timezone).date;
}
export function dueLabel(task: Task, today: string, timezone: string) {
  if (task.attention.length || !task.due.date) return 'Needs attention';
  const { date, time, instant } = displayDue(task, timezone);
  if ((instant && instant.epochMilliseconds < Date.now()) || date! < today) return 'Overdue';
  if (date === today) return time ? `Today · ${time}` : 'Due today';
  return `${formatDate(date)}${time ? ` · ${time}` : ''}`;
}
export function TaskCard({
  task,
  today,
  timezone,
  onOpen,
  onComplete,
}: {
  task: Task;
  today: string;
  timezone: string;
  onOpen: () => void;
  onComplete: () => void;
}) {
  const label = dueLabel(task, today, timezone),
    done = task.state === 'completed';
  return (
    <article className={`task-card ${done ? 'is-complete' : ''}`}>
      <button
        className={`complete-button ${done ? 'checked' : ''}`}
        onClick={onComplete}
        aria-label={`${done ? 'Reopen' : 'Complete'} ${task.title}`}
      >
        {done && <Check size={15} />}
      </button>
      <CategoryIcon category={task.category} />
      <button className="task-body" onClick={onOpen}>
        <span className="task-topline">
          {categoryLabel[task.category]}
          <span>·</span>
          {task.organization || 'From your document'}
        </span>
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          <span
            className={`due-label ${label === 'Overdue' ? 'overdue' : task.attention.length ? 'attention' : ''}`}
          >
            {task.attention.length ? <AlertCircle size={12} /> : <CalendarDays size={12} />}{' '}
            {done ? 'Completed' : label}
          </span>
          <span className="auto-label">
            {task.synthetic
              ? 'Synthetic example'
              : task.edited
                ? 'Edited by you'
                : 'Auto-extracted'}
          </span>
        </span>
      </button>
      <div className="task-end">
        {task.amount && (
          <strong>
            {task.currency ? `${task.currency} ` : ''}
            {Number(task.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </strong>
        )}
        <button
          className="icon-button"
          aria-label={`View source for ${task.title}`}
          onClick={onOpen}
        >
          <ArrowUpRight size={19} />
        </button>
      </div>
    </article>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      aria-label={title}
      className={`modal ${wide ? 'wide' : ''}`}
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={22} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <FileText size={25} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
export function PaperIllustration() {
  return (
    <svg className="paper-illustration" viewBox="0 0 280 200" fill="none" aria-hidden="true">
      <ellipse cx="153" cy="175" rx="103" ry="11" fill="#DDDCCB" opacity=".45" />
      <rect
        x="70"
        y="36"
        width="132"
        height="135"
        rx="9"
        transform="rotate(-13 70 36)"
        fill="#DDE5CA"
        stroke="#C5CFB3"
      />
      <rect
        x="98"
        y="22"
        width="126"
        height="150"
        rx="8"
        transform="rotate(9 98 22)"
        fill="#FFFEF8"
        stroke="#D5D8C9"
      />
      <path
        d="m120 53 61 10m-65 7 81 13m-84 6 66 11"
        stroke="#B5C2B3"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <rect
        x="118"
        y="111"
        width="62"
        height="25"
        rx="12.5"
        transform="rotate(9 118 111)"
        fill="#E5EDDA"
      />
      <path d="m128 123 5 6 11-11" stroke="#527662" strokeWidth="2" strokeLinecap="round" />
      <circle cx="219" cy="140" r="26" fill="#E0AD6D" />
      <path
        d="m208 140 8 8 15-17"
        stroke="#FFF9EF"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m51 75 3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="#98AE86" />
      <path d="m231 36 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" fill="#D6B487" />
    </svg>
  );
}
