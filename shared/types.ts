export type Category = 'payment' | 'appointment' | 'deadline';
export type TaskState = 'open' | 'completed' | 'dismissed' | 'deleted';
export type DocumentState =
  'queued' | 'processing' | 'completed' | 'partial' | 'failed' | 'deleting';
export interface Source {
  id: string;
  label: string;
  text: string;
  kind: 'pdf' | 'docx' | 'image';
  page?: number;
  ocr?: boolean;
}
export interface Due {
  kind: 'none' | 'date' | 'datetime';
  date: string | null;
  time: string | null;
  timezone: string | null;
}
export interface Task {
  id: string;
  documentId: string;
  title: string;
  category: Category;
  due: Due;
  amount: string | null;
  currency: string | null;
  organization: string | null;
  excerpt: string;
  sourceId: string;
  attention: string[];
  state: TaskState;
  edited: boolean;
  revision: number;
  synthetic: boolean;
  createdAt: string;
}
export interface Document {
  id: string;
  name: string;
  mime: string;
  size: number;
  state: DocumentState;
  sources: Source[];
  warning: string | null;
  taskCount: number;
  synthetic: boolean;
  createdAt: string;
  attempts: number;
}
export interface Profile {
  name: string;
  email: string;
  timezone: string;
  onboarded: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  leadDays: number;
  reminderHour: number;
}
export interface Notice {
  id: string;
  task_id: string;
  channel: string;
  status: string;
  scheduled_at: string;
  error: string | null;
}
export interface Snapshot {
  profile: Profile;
  documents: Document[];
  tasks: Task[];
  reminders: Notice[];
}
export interface AppConfig {
  development: boolean;
  authConfigured: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  openaiConfigured: boolean;
  emailConfigured: boolean;
  pushConfigured: boolean;
  vapidPublicKey: string;
}
