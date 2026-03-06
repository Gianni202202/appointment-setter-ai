import {Conversation, Message, AgentConfig, ConversationState, DashboardMetrics, AgentMode, DraftMessage} from '@/types';
import * as fsNode from 'fs';
import * as pathNode from 'path';

// ============================================
// In-Memory Database (replace with Supabase later)
// ============================================

let conversations: Conversation[] = [];
let allMessages: Message[] = [];

// Connected LinkedIn account — only set after user explicitly connects
let linkedInAccount: {
  account_id: string;
  name: string;
  connected_at: string;
} | null = null;

const defaultConfig: AgentConfig = {
  icp: {
    industries: ['SaaS', 'Technology', 'E-commerce', 'Marketing'],
    roles: ['CEO', 'Founder', 'CTO', 'Head of Sales', 'VP Marketing', 'Director'],
    company_size_min: 10,
    company_size_max: 500,
    keywords: ['growth', 'scaling', 'automation', 'leads', 'pipeline'],
    description: 'B2B SaaS founders and executives looking to scale their outbound sales',
  },
  tone: {
    style: 'professional',
    language: 'nl',
    max_message_length: 500,
    first_person_name: 'Gianni',
    example_messages: [
      'Hey [naam], zag je post over [onderwerp]. Interessante kijk. Hoe gaan jullie om met [relevant probleem]?',
      'Bedankt voor de connectie! Viel me op dat jullie flink aan het groeien zijn. Herkenbaar — welke uitdaging speelt het meest op dit moment?',
    ],
  },
  rules: {
    no_links_first_touch: true,
    no_calendar_first_touch: true,
    max_follow_ups: 3,
    follow_up_delay_hours: 48,
    auto_respond: false,
    working_hours_start: 9,
    working_hours_end: 18,
    goal: 'Book a 30-minute discovery call to discuss how we can help them scale their business',
    offer_description: 'We help B2B companies automate and scale their outbound sales pipeline using AI-powered conversation management.',
  },
  blacklist: [],
};

let agentConfig: AgentConfig = { ...defaultConfig };

// GLOBAL AGENT TOGGLE — removed, use agentMode instead

// ============================================
// File-based persistence (survives Vercel cold starts)
// ============================================
const PERSIST_DIR = '/tmp/appointment-setter-persist';

function ensurePersistDir() {
  try { fsNode.mkdirSync(PERSIST_DIR, { recursive: true }); } catch {}
}

function readPersisted<T>(key: string, fallback: T): T {
  try {
    ensurePersistDir();
    const data = fsNode.readFileSync(pathNode.join(PERSIST_DIR, key + '.json'), 'utf8');
    return JSON.parse(data);
  } catch { return fallback; }
}

function writePersisted(key: string, value: any) {
  try {
    ensurePersistDir();
    fsNode.writeFileSync(pathNode.join(PERSIST_DIR, key + '.json'), JSON.stringify(value));
  } catch (e) { console.error('[Persist] Write error:', e); }
}

// Global Agent Toggle — REMOVED (use agentMode 'off'/'copilot'/'auto' instead)

// ============================================
// LinkedIn Account
// ============================================

export function getLinkedInAccount() {
  return linkedInAccount;
}

export function setLinkedInAccount(data: { account_id: string; name: string }) {
  linkedInAccount = { ...data, connected_at: new Date().toISOString() };
}

export function disconnectLinkedIn() {
  linkedInAccount = null;
}

// ============================================
// Conversation CRUD
// ============================================

export function getConversations(): Conversation[] {
  return conversations.sort(
    (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
  );
}

export function getConversation(id: string): Conversation | undefined {
  const conv = conversations.find((c) => c.id === id);
  if (conv) {
    conv.messages = allMessages
      .filter((m) => m.conversation_id === id)
      .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
  }
  return conv;
}

export function getConversationByChatId(chatId: string): Conversation | undefined {
  const conv = conversations.find((c) => c.unipile_chat_id === chatId);
  if (conv) {
    conv.messages = allMessages
      .filter((m) => m.conversation_id === conv.id)
      .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
  }
  return conv;
}

export function createConversation(data: Omit<Conversation, 'id' | 'created_at' | 'updated_at' | 'messages'>): Conversation {
  const conv: Conversation = {
    ...data,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: [],
  };
  conversations.push(conv);
  return conv;
}

export function updateConversationState(id: string, state: ConversationState): void {
  const conv = conversations.find((c) => c.id === id);
  if (conv) {
    conv.state = state;
    conv.updated_at = new Date().toISOString();
  }
}

export function updateConversation(id: string, updates: Partial<Conversation>): void {
  const conv = conversations.find((c) => c.id === id);
  if (conv) {
    Object.assign(conv, updates);
    conv.updated_at = new Date().toISOString();
  }
}

// ============================================
// Message CRUD
// ============================================

export function addMessage(data: Omit<Message, 'id'>): Message {
  const msg: Message = {
    ...data,
    id: crypto.randomUUID(),
  };
  allMessages.push(msg);

  const conv = conversations.find((c) => c.id === data.conversation_id);
  if (conv) {
    conv.last_message_at = data.sent_at;
    conv.updated_at = new Date().toISOString();
  }

  return msg;
}

export function getMessagesByConversation(conversationId: string): Message[] {
  return allMessages
    .filter((m) => m.conversation_id === conversationId)
    .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
}

// ============================================
// Config
// ============================================

export function getConfig(): AgentConfig {
  return agentConfig;
}

export function updateConfig(config: Partial<AgentConfig>): AgentConfig {
  agentConfig = { ...agentConfig, ...config };
  return agentConfig;
}

export function getDefaultConfig(): AgentConfig {
  return { ...defaultConfig };
}

// ============================================
// Metrics (calculated from real data only)
// ============================================

export function getMetrics(): DashboardMetrics {
  const total = conversations.length;
  const active = conversations.filter((c) => !['dead', 'booked'].includes(c.state)).length;
  const withReplies = conversations.filter((c) =>
    allMessages.some((m) => m.conversation_id === c.id && m.role === 'prospect')
  ).length;
  const booked = conversations.filter((c) => c.state === 'booked').length;

  const stateCount: Record<ConversationState, number> = {
    new: 0, engaged: 0, objection: 0, qualified: 0, booked: 0, dead: 0, handoff: 0,
  };
  conversations.forEach((c) => { stateCount[c.state]++; });

  return {
    total_conversations: total,
    active_conversations: active,
    reply_rate: total > 0 ? Math.round((withReplies / total) * 100) : 0,
    meetings_booked: booked,
    avg_response_time_minutes: 0,
    conversations_by_state: stateCount,
  };
}

// ============================================
// Agent Mode (auto | copilot | off) — FILE-PERSISTED
// ============================================
let agentMode: AgentMode = readPersisted<AgentMode>('agent_mode', 'off');

export function getAgentMode(): AgentMode { return agentMode; }
export function setAgentMode(mode: AgentMode) {
  agentMode = mode;
  writePersisted('agent_mode', mode);
  console.log('[Agent] Mode set to:', mode);
}

// ============================================
// Draft Queue (for Copilot mode) — FILE-PERSISTED
// ============================================
let draftCounter = readPersisted<number>('draft_counter', 0);

function readDraftQueue(): DraftMessage[] {
  return readPersisted<DraftMessage[]>('draft_queue', []);
}

function writeDraftQueue(queue: DraftMessage[]) {
  writePersisted('draft_queue', queue);
}

export function addDraft(draft: Omit<DraftMessage, 'id' | 'status' | 'created_at'>): DraftMessage {
  const queue = readDraftQueue();
  draftCounter++;
  writePersisted('draft_counter', draftCounter);
  const newDraft: DraftMessage = {
    ...draft,
    id: 'draft_' + draftCounter + '_' + Date.now(),
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  queue.push(newDraft);
  writeDraftQueue(queue);
  return newDraft;
}

export function getDrafts(status?: string): DraftMessage[] {
  const queue = readDraftQueue();
  if (status) return queue.filter(d => d.status === status);
  return [...queue];
}

export function getDraft(id: string): DraftMessage | undefined {
  return readDraftQueue().find(d => d.id === id);
}

export function updateDraft(id: string, updates: Partial<DraftMessage>): DraftMessage | null {
  const queue = readDraftQueue();
  const draft = queue.find(d => d.id === id);
  if (!draft) return null;
  Object.assign(draft, updates);
  writeDraftQueue(queue);
  return draft;
}

export function removeDraft(id: string): boolean {
  const queue = readDraftQueue();
  const idx = queue.findIndex(d => d.id === id);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  writeDraftQueue(queue);
  return true;
}

export function getSentTodayCount(): number {
  const today = new Date().toISOString().split('T')[0];
  return readDraftQueue().filter(d => d.status === 'sent' && d.sent_at?.startsWith(today)).length;
}

// ============================================
// CONVERSATION MEMORY — per-chat context storage
// ============================================
interface ConversationMemory {
  chat_id: string;
  facts: {
    team_size?: string;
    tools_mentioned?: string[];
    pain_points?: string[];
    interests?: string[];
    role?: string;
    company?: string;
    language_preference?: string;
    custom_notes?: string[];
  };
  previous_openers: string[];  // Track last 5 openers used (for variance)
  updated_at: string;
}

const conversationMemories: Map<string, ConversationMemory> = new Map();

export function getConversationMemory(chatId: string): ConversationMemory | undefined {
  return conversationMemories.get(chatId);
}

export function updateConversationMemory(chatId: string, updates: Partial<ConversationMemory['facts']>) {
  const existing = conversationMemories.get(chatId);
  if (existing) {
    existing.facts = { ...existing.facts, ...updates };
    existing.updated_at = new Date().toISOString();
  } else {
    conversationMemories.set(chatId, {
      chat_id: chatId,
      facts: updates,
      previous_openers: [],
      updated_at: new Date().toISOString(),
    });
  }
}

export function addPreviousOpener(chatId: string, opener: string) {
  const mem = conversationMemories.get(chatId);
  if (mem) {
    mem.previous_openers.push(opener);
    if (mem.previous_openers.length > 5) mem.previous_openers.shift();
  } else {
    conversationMemories.set(chatId, {
      chat_id: chatId,
      facts: {},
      previous_openers: [opener],
      updated_at: new Date().toISOString(),
    });
  }
}

export function getPreviousOpeners(chatId: string): string[] {
  return conversationMemories.get(chatId)?.previous_openers || [];
}

// ============================================
// CONVERSATION PHASE — auto-detected, persisted
// ============================================
const conversationPhases: Map<string, string> = new Map();

export function getConversationPhase(chatId: string): string | undefined {
  return conversationPhases.get(chatId);
}

export function setConversationPhase(chatId: string, phase: string) {
  conversationPhases.set(chatId, phase);
}

// ============================================
// WARM-UP PERIOD — track account activation
// ============================================
let accountActivatedAt: string | null = readPersisted<string | null>('account_activated_at', null);

export function getAccountActivatedAt(): string | null {
  return accountActivatedAt;
}

export function setAccountActivatedAt(date?: string) {
  accountActivatedAt = date || new Date().toISOString();
  writePersisted('account_activated_at', accountActivatedAt);
}

export function getAccountAgeWeeks(): number {
  if (!accountActivatedAt) return 99; // Assume mature if not tracked
  const ageMs = Date.now() - new Date(accountActivatedAt).getTime();
  return Math.floor(ageMs / (7 * 24 * 60 * 60 * 1000));
}

// ============================================
// Agent Chat History (in-dashboard conversation)
// ============================================

interface AgentChatMessage {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  actions?: { type: string; result?: string }[];
}

let agentChatHistory: AgentChatMessage[] = [];

let agentScanSettings: {
  maxAgeDays: number;
  phases: string[];
  limit: number;
  autoSend: boolean;
} = {
  maxAgeDays: 30,
  phases: [],
  limit: 20,
  autoSend: false,
};

export function getAgentChatHistory(): AgentChatMessage[] {
  return agentChatHistory.slice(-30);
}

export function addAgentChatMessage(msg: AgentChatMessage) {
  agentChatHistory.push(msg);
  if (agentChatHistory.length > 50) agentChatHistory = agentChatHistory.slice(-30);
}

export function clearAgentChatHistory() {
  agentChatHistory = [];
}

export function getAgentScanSettings() {
  return { ...agentScanSettings };
}

export function updateAgentScanSettings(updates: Partial<typeof agentScanSettings>) {
  agentScanSettings = { ...agentScanSettings, ...updates };
}


// ============================================
// ACTIVITY LOG — CRM tracking
// ============================================
interface ActivityEntry {
  id: string;
  type: 'draft_created' | 'draft_approved' | 'draft_rejected' | 'message_sent' | 'reply_received' | 'label_changed' | 'mode_changed';
  prospect: string;
  details: any;
  timestamp: string;
}

function readActivityLog(): ActivityEntry[] {
  return readPersisted<ActivityEntry[]>('activity_log', []);
}

function writeActivityLog(log: ActivityEntry[]) {
  writePersisted('activity_log', log);
}

export function logActivity(type: ActivityEntry['type'], prospect: string, details: any = {}) {
  const log = readActivityLog();
  log.unshift({
    id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    type,
    prospect,
    details,
    timestamp: new Date().toISOString(),
  });
  // Keep last 500 entries
  writeActivityLog(log.slice(0, 500));
}

export function getActivityLog(limit = 50, offset = 0): ActivityEntry[] {
  const log = readActivityLog();
  return log.slice(offset, offset + limit);
}

export function getActivityCount(): number {
  return readActivityLog().length;
}

// ============================================
// PROSPECT LABELS — user-defined tags per chat
// ============================================
interface ProspectLabel {
  chat_id: string;
  prospect_name: string;
  label: string; // actief | wacht | afgewezen | call_gepland | klant | custom
  color: string;
  updated_at: string;
}

function readLabels(): ProspectLabel[] {
  return readPersisted<ProspectLabel[]>('prospect_labels', []);
}

function writeLabels(labels: ProspectLabel[]) {
  writePersisted('prospect_labels', labels);
}

export function setProspectLabel(chatId: string, prospectName: string, label: string, color: string = '') {
  const labels = readLabels();
  const existing = labels.find(l => l.chat_id === chatId);
  if (existing) {
    existing.label = label;
    existing.color = color || existing.color;
    existing.updated_at = new Date().toISOString();
  } else {
    labels.push({ chat_id: chatId, prospect_name: prospectName, label, color, updated_at: new Date().toISOString() });
  }
  writeLabels(labels);
  logActivity('label_changed', prospectName, { chat_id: chatId, label });
}

export function getProspectLabel(chatId: string): ProspectLabel | undefined {
  return readLabels().find(l => l.chat_id === chatId);
}

export function getAllLabels(): ProspectLabel[] {
  return readLabels();
}
