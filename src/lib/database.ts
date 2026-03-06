import {Conversation, Message, AgentConfig, ConversationState, DashboardMetrics, AgentMode, DraftMessage, Prospect, ProspectStatus} from '@/types';
import Redis from 'ioredis';

// ============================================
// Redis connection — persistent across deploys
// ============================================
const REDIS_URL = process.env.REDIS_URL || '';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis && REDIS_URL) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      connectTimeout: 5000,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    redis.on('error', (err) => console.warn('[Redis] Connection error:', err.message));
  }
  if (!redis) {
    throw new Error('REDIS_URL not configured');
  }
  return redis;
}

// ============================================
// Redis helpers — graceful fallback
// ============================================
async function rGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const r = getRedis();
    const val = await r.get(key);
    return val ? JSON.parse(val) : fallback;
  } catch (err) {
    console.warn('[Redis] Read error for', key, ':', err instanceof Error ? err.message : err);
    return fallback;
  }
}

async function rSet(key: string, value: any): Promise<void> {
  try {
    const r = getRedis();
    await r.set(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[Redis] Write error for', key, ':', err instanceof Error ? err.message : err);
  }
}

// ============================================
// In-memory data (synced from Unipile, not persisted)
// ============================================
let conversations: Conversation[] = [];
let allMessages: Message[] = [];

const defaultConfig: AgentConfig = {
  icp: {
    industries: ['Recruitment', 'Staffing', 'Detachering', 'Executive Search', 'HR Tech'],
    roles: ['Recruiter', 'Recruitment Manager', 'Talent Acquisition', 'Founder', 'Director', 'Head of Recruitment', 'Managing Partner'],
    company_size_min: 5,
    company_size_max: 250,
    keywords: ['outbound', 'sourcing', 'candidates', 'recruitment', 'hiring', 'outreach', 'personalisatie'],
    description: 'Recruitment bureaus en inhouse recruitment teams die actief outbound doen en hun berichten willen personaliseren op schaal, zonder dat het generiek wordt.',
  },
  tone: {
    style: 'casual',
    language: 'nl',
    max_message_length: 300,
    first_person_name: 'Gianni',
    example_messages: [
      'Ha, zag dat jullie flink aan het groeien zijn met het team. Herkenbaar. Hoe pakken jullie outbound nu aan?',
      'Nice, snap ik. Hoeveel berichten sturen jullie ongeveer per week? Puur even benieuwd of het volume groot genoeg is.',
      'Logisch. De meeste bureaus die ik spreek worstelen met datzelfde — veel tijd kwijt aan personaliseren maar generiek werkt niet. Hoe lossen jullie dat nu op?',
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
    goal: 'Prospect warm maken via natuurlijke DM-gesprekken, richting een korte Loom-video en dan een 10 min sparcall om te kijken of Elvatix past.',
    offer_description: 'Elvatix zet outreach berichten op schaal klaar op basis van je eigen template en tone of voice. Jij checkt, tweakt en verstuurt — bulk zonder copy paste, maar wel persoonlijk.',
  },
  blacklist: [],
  best_practices: '',
  strategies: [],
};

let agentConfig: AgentConfig = { ...defaultConfig };

// ============================================
// LinkedIn Account — Redis persisted
// ============================================
let linkedInAccount: { account_id: string; name: string; connected_at: string; } | null = null;

export function getLinkedInAccount() { return linkedInAccount; }

export async function setLinkedInAccount(data: { account_id: string; name: string }) {
  linkedInAccount = { ...data, connected_at: new Date().toISOString() };
  await rSet('linkedin:account', linkedInAccount);
}

export async function disconnectLinkedIn() {
  linkedInAccount = null;
  await rSet('linkedin:account', null);
}

// ============================================
// Conversation CRUD (in-memory — synced from Unipile)
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
  if (conv) { conv.state = state; conv.updated_at = new Date().toISOString(); }
}

export function updateConversation(id: string, updates: Partial<Conversation>): void {
  const conv = conversations.find((c) => c.id === id);
  if (conv) { Object.assign(conv, updates); conv.updated_at = new Date().toISOString(); }
}

// ============================================
// Message CRUD (in-memory)
// ============================================
export function addMessage(data: Omit<Message, 'id'>): Message {
  const msg: Message = { ...data, id: crypto.randomUUID() };
  allMessages.push(msg);
  const conv = conversations.find((c) => c.id === data.conversation_id);
  if (conv) { conv.last_message_at = data.sent_at; conv.updated_at = new Date().toISOString(); }
  return msg;
}

export function getMessagesByConversation(conversationId: string): Message[] {
  return allMessages
    .filter((m) => m.conversation_id === conversationId)
    .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
}

// ============================================
// Config — Redis persisted
// ============================================
export function getConfig(): AgentConfig { return agentConfig; }

export async function getConfigAsync(): Promise<AgentConfig> {
  const stored = await rGet<AgentConfig | null>('agent:config', null);
  if (stored) agentConfig = stored;
  return agentConfig;
}

export async function updateConfig(config: Partial<AgentConfig>): Promise<AgentConfig> {
  agentConfig = { ...agentConfig, ...config };
  await rSet('agent:config', agentConfig);
  return agentConfig;
}

export function getDefaultConfig(): AgentConfig { return { ...defaultConfig }; }

// ============================================
// Metrics
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
    total_conversations: total, active_conversations: active,
    reply_rate: total > 0 ? Math.round((withReplies / total) * 100) : 0,
    meetings_booked: booked, avg_response_time_minutes: 0,
    conversations_by_state: stateCount,
  };
}

// ============================================
// Agent Mode — Redis persisted
// ============================================
let agentMode: AgentMode = 'off';

export function getAgentMode(): AgentMode { return agentMode; }
export async function getAgentModeAsync(): Promise<AgentMode> {
  agentMode = await rGet<AgentMode>('agent:mode', 'off');
  return agentMode;
}
export async function setAgentMode(mode: AgentMode) {
  agentMode = mode;
  await rSet('agent:mode', mode);
  console.log('[Agent] Mode set to:', mode);
}

// ============================================
// Draft Queue — Redis persisted ⭐
// ============================================
export async function addDraft(draft: Omit<DraftMessage, 'id' | 'status' | 'created_at'>): Promise<DraftMessage> {
  const counter = await rGet<number>('draft:counter', 0);
  const newCounter = counter + 1;
  await rSet('draft:counter', newCounter);

  const newDraft: DraftMessage = {
    ...draft,
    id: 'draft_' + newCounter + '_' + Date.now(),
    status: 'pending',
    created_at: new Date().toISOString(),
  };

  let queue = await rGet<DraftMessage[]>('draft:queue', []);
  queue.push(newDraft);

  // Auto-prune: keep max 200 drafts. Remove old sent/rejected/failed first.
  if (queue.length > 200) {
    const today = new Date().toISOString().split('T')[0];
    queue = queue.filter(d =>
      d.status === 'pending' || d.status === 'approved' ||
      (d.status === 'sent' && d.sent_at?.startsWith(today)) ||
      d.id === newDraft.id
    );
    // If still too many, trim from the beginning
    if (queue.length > 200) {
      queue = queue.slice(-200);
    }
  }

  await rSet('draft:queue', queue);
  return newDraft;
}

export async function getDrafts(status?: string): Promise<DraftMessage[]> {
  const queue = await rGet<DraftMessage[]>('draft:queue', []);
  if (status) return queue.filter(d => d.status === status);
  return [...queue];
}

export async function getDraft(id: string): Promise<DraftMessage | undefined> {
  const queue = await rGet<DraftMessage[]>('draft:queue', []);
  return queue.find(d => d.id === id);
}

export async function updateDraft(id: string, updates: Partial<DraftMessage>): Promise<DraftMessage | null> {
  const queue = await rGet<DraftMessage[]>('draft:queue', []);
  const draft = queue.find(d => d.id === id);
  if (!draft) return null;
  Object.assign(draft, updates);
  await rSet('draft:queue', queue);
  return draft;
}

export async function removeDraft(id: string): Promise<boolean> {
  const queue = await rGet<DraftMessage[]>('draft:queue', []);
  const idx = queue.findIndex(d => d.id === id);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  await rSet('draft:queue', queue);
  return true;
}

export async function removeDraftsBulk(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const queue = await rGet<DraftMessage[]>('draft:queue', []);
  const idSet = new Set(ids);
  const filtered = queue.filter(d => !idSet.has(d.id));
  const removed = queue.length - filtered.length;
  if (removed > 0) {
    await rSet('draft:queue', filtered);
  }
  return removed;
}

export async function getSentTodayCount(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const queue = await rGet<DraftMessage[]>('draft:queue', []);
  return queue.filter(d => d.status === 'sent' && d.sent_at?.startsWith(today)).length;
}

// ============================================
// CONVERSATION MEMORY — in-memory + Redis backup
// ============================================
interface ConversationMemory {
  chat_id: string;
  facts: {
    team_size?: string; tools_mentioned?: string[]; pain_points?: string[];
    interests?: string[]; role?: string; company?: string;
    language_preference?: string; custom_notes?: string[];
  };
  previous_openers: string[];
  updated_at: string;
}

const conversationMemories: Map<string, ConversationMemory> = new Map();

export function getConversationMemory(chatId: string): ConversationMemory | undefined {
  return conversationMemories.get(chatId);
}

export async function getConversationMemoryAsync(chatId: string): Promise<ConversationMemory | undefined> {
  // On cold start, restore from Redis
  if (conversationMemories.size === 0) {
    const stored = await rGet<Record<string, ConversationMemory>>('conv:memories', {});
    Object.entries(stored).forEach(([k, v]) => conversationMemories.set(k, v));
  }
  return conversationMemories.get(chatId);
}

export async function updateConversationMemory(chatId: string, updates: Partial<ConversationMemory['facts']>) {
  const existing = conversationMemories.get(chatId);
  if (existing) {
    existing.facts = { ...existing.facts, ...updates };
    existing.updated_at = new Date().toISOString();
  } else {
    conversationMemories.set(chatId, {
      chat_id: chatId, facts: updates, previous_openers: [],
      updated_at: new Date().toISOString(),
    });
  }
  await rSet('conv:memories', Object.fromEntries(conversationMemories));
}

export async function addPreviousOpener(chatId: string, opener: string) {
  const mem = conversationMemories.get(chatId);
  if (mem) {
    mem.previous_openers.push(opener);
    if (mem.previous_openers.length > 5) mem.previous_openers.shift();
  } else {
    conversationMemories.set(chatId, {
      chat_id: chatId, facts: {}, previous_openers: [opener],
      updated_at: new Date().toISOString(),
    });
  }
  await rSet('conv:memories', Object.fromEntries(conversationMemories));
}

export function getPreviousOpeners(chatId: string): string[] {
  return conversationMemories.get(chatId)?.previous_openers || [];
}

export async function getPreviousOpenersAsync(chatId: string): Promise<string[]> {
  if (conversationMemories.size === 0) {
    const stored = await rGet<Record<string, ConversationMemory>>('conv:memories', {});
    Object.entries(stored).forEach(([k, v]) => conversationMemories.set(k, v));
  }
  return conversationMemories.get(chatId)?.previous_openers || [];
}

// ============================================
// CONVERSATION PHASE — in-memory + Redis backup
// ============================================
const conversationPhases: Map<string, string> = new Map();

export function getConversationPhase(chatId: string): string | undefined {
  return conversationPhases.get(chatId);
}

export async function getConversationPhaseAsync(chatId: string): Promise<string | undefined> {
  // On cold start, restore from Redis
  if (conversationPhases.size === 0) {
    const stored = await rGet<Record<string, string>>('conv:phases', {});
    Object.entries(stored).forEach(([k, v]) => conversationPhases.set(k, v));
  }
  return conversationPhases.get(chatId);
}

export async function setConversationPhase(chatId: string, phase: string) {
  conversationPhases.set(chatId, phase);
  await rSet('conv:phases', Object.fromEntries(conversationPhases));
}

// ============================================
// WARM-UP PERIOD
// ============================================
let accountActivatedAt: string | null = null;

export function getAccountActivatedAt(): string | null { return accountActivatedAt; }
export async function getAccountActivatedAtAsync(): Promise<string | null> {
  accountActivatedAt = await rGet<string | null>('account:activated_at', null);
  return accountActivatedAt;
}
export async function setAccountActivatedAt(date?: string) {
  accountActivatedAt = date || new Date().toISOString();
  await rSet('account:activated_at', accountActivatedAt);
}
export function getAccountAgeWeeks(): number {
  if (!accountActivatedAt) return 99;
  const ageMs = Date.now() - new Date(accountActivatedAt).getTime();
  return Math.floor(ageMs / (7 * 24 * 60 * 60 * 1000));
}

// ============================================
// Agent Chat History (in-memory)
// ============================================
interface AgentChatMessage {
  role: 'user' | 'agent'; content: string; timestamp: string;
  actions?: { type: string; result?: string }[];
}

let agentChatHistory: AgentChatMessage[] = [];
let agentScanSettings = { maxAgeDays: 30, phases: [] as string[], limit: 20, autoSend: false };

export function getAgentChatHistory() { return agentChatHistory.slice(-30); }
export async function getAgentChatHistoryAsync() {
  const stored = await rGet<AgentChatMessage[]>('agent:chatHistory', []);
  if (stored.length > 0 && agentChatHistory.length === 0) agentChatHistory = stored;
  return agentChatHistory.slice(-30);
}
export async function addAgentChatMessage(msg: AgentChatMessage) {
  agentChatHistory.push(msg);
  if (agentChatHistory.length > 50) agentChatHistory = agentChatHistory.slice(-30);
  await rSet('agent:chatHistory', agentChatHistory);
}
export function clearAgentChatHistory() { agentChatHistory = []; }
export function getAgentScanSettings() { return { ...agentScanSettings }; }
export async function getAgentScanSettingsAsync() {
  const stored = await rGet<typeof agentScanSettings | null>('agent:scanSettings', null);
  if (stored) agentScanSettings = stored;
  return { ...agentScanSettings };
}
export async function updateAgentScanSettings(updates: Partial<typeof agentScanSettings>) {
  agentScanSettings = { ...agentScanSettings, ...updates };
  await rSet('agent:scanSettings', agentScanSettings);
}

// ============================================
// ACTIVITY LOG — Redis persisted ⭐
// ============================================
interface ActivityEntry {
  id: string;
  type: 'draft_created' | 'draft_approved' | 'draft_rejected' | 'message_sent' | 'reply_received' | 'label_changed' | 'mode_changed';
  prospect: string; details: any; timestamp: string;
}

export async function logActivity(type: ActivityEntry['type'], prospect: string, details: any = {}) {
  const log = await rGet<ActivityEntry[]>('activity:log', []);
  log.unshift({
    id: 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    type, prospect, details, timestamp: new Date().toISOString(),
  });
  await rSet('activity:log', log.slice(0, 500));
}

export async function getActivityLog(limit = 50, offset = 0): Promise<ActivityEntry[]> {
  const log = await rGet<ActivityEntry[]>('activity:log', []);
  return log.slice(offset, offset + limit);
}

export async function getActivityCount(): Promise<number> {
  const log = await rGet<ActivityEntry[]>('activity:log', []);
  return log.length;
}

// ============================================
// PROSPECT LABELS — Redis persisted ⭐
// ============================================
interface ProspectLabel {
  chat_id: string; prospect_name: string; label: string; color: string; updated_at: string;
}

export async function setProspectLabel(chatId: string, prospectName: string, label: string, color: string = '') {
  const labels = await rGet<ProspectLabel[]>('prospect:labels', []);
  const existing = labels.find(l => l.chat_id === chatId);
  if (existing) {
    existing.label = label; existing.color = color || existing.color;
    existing.updated_at = new Date().toISOString();
  } else {
    labels.push({ chat_id: chatId, prospect_name: prospectName, label, color, updated_at: new Date().toISOString() });
  }
  await rSet('prospect:labels', labels);
  await logActivity('label_changed', prospectName, { chat_id: chatId, label });
}

export async function getProspectLabel(chatId: string): Promise<ProspectLabel | undefined> {
  const labels = await rGet<ProspectLabel[]>('prospect:labels', []);
  return labels.find(l => l.chat_id === chatId);
}

export async function getAllLabels(): Promise<ProspectLabel[]> {
  return rGet<ProspectLabel[]>('prospect:labels', []);
}


// ============================================
// SCAN RESULTS CACHE — Redis persisted
// ============================================
export async function saveScanResults(results: any[]): Promise<void> {
  await rSet('scan:last_results', results);
  await rSet('scan:last_run', new Date().toISOString());
}

export async function getScanResults(): Promise<any[]> {
  return rGet<any[]>('scan:last_results', []);
}

export async function getLastScanTime(): Promise<string | null> {
  return rGet<string | null>('scan:last_run', null);
}

export async function updateScanResult(chatId: string, updates: any): Promise<void> {
  const results = await rGet<any[]>('scan:last_results', []);
  const idx = results.findIndex((r: any) => r.chat_id === chatId);
  if (idx >= 0) {
    Object.assign(results[idx], updates);
    await rSet('scan:last_results', results);
  }
}

// ============================================
// REJECTED CHATS — Redis persisted
// ============================================
export async function addRejectedChat(chatId: string): Promise<void> {
  const rejected = await rGet<string[]>('rejected:chats', []);
  if (!rejected.includes(chatId)) {
    rejected.push(chatId);
    await rSet('rejected:chats', rejected);
  }
}

export async function getRejectedChats(): Promise<string[]> {
  return rGet<string[]>('rejected:chats', []);
}

export async function isRejectedChat(chatId: string): Promise<boolean> {
  const rejected = await rGet<string[]>('rejected:chats', []);
  return rejected.includes(chatId);
}


// ============================================
// PROSPECTS — Redis persisted ⭐
// ============================================
export async function getProspects(status?: ProspectStatus): Promise<Prospect[]> {
  const all = await rGet<Prospect[]>('prospect:list', []);
  if (status) return all.filter(p => p.status === status);
  return all;
}

export async function getProspect(id: string): Promise<Prospect | undefined> {
  const all = await rGet<Prospect[]>('prospect:list', []);
  return all.find(p => p.id === id);
}

export async function getProspectByProviderId(providerId: string): Promise<Prospect | undefined> {
  const all = await rGet<Prospect[]>('prospect:list', []);
  return all.find(p => p.provider_id === providerId);
}

export async function addProspect(prospect: Omit<Prospect, 'id' | 'status' | 'enriched' | 'imported_at' | 'updated_at'>): Promise<Prospect> {
  const all = await rGet<Prospect[]>('prospect:list', []);
  
  // Dedup by provider_id
  const existing = all.find(p => p.provider_id === prospect.provider_id);
  if (existing) return existing;
  
  const newProspect: Prospect = {
    ...prospect,
    id: 'prsp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    status: 'imported',
    enriched: false,
    imported_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  all.push(newProspect);
  await rSet('prospect:list', all);
  return newProspect;
}

export async function addProspectsBulk(prospects: Omit<Prospect, 'id' | 'status' | 'enriched' | 'imported_at' | 'updated_at'>[]): Promise<{ added: number; skipped: number; alreadyConnected: number; alreadyInvited: number }> {
  const all = await rGet<Prospect[]>('prospect:list', []);
  const existingIds = new Set(all.map(p => p.provider_id));
  let added = 0;
  let skipped = 0;
  let alreadyConnected = 0;
  let alreadyInvited = 0;
  
  for (const prospect of prospects) {
    if (existingIds.has(prospect.provider_id)) {
      skipped++;
      continue;
    }
    
    // Detect status from search results (set by searchResultToProspect)
    const autoStatus = (prospect as any)._autoStatus;
    let status: ProspectStatus = 'imported';
    if (autoStatus === 'connected') {
      status = 'connected';
      alreadyConnected++;
    } else if (autoStatus === 'invite_sent') {
      status = 'invite_sent';
      alreadyInvited++;
    }
    
    // Remove internal field
    const cleanProspect = { ...prospect };
    delete (cleanProspect as any)._autoStatus;
    
    all.push({
      ...cleanProspect,
      id: 'prsp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      status,
      enriched: false,
      imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    existingIds.add(prospect.provider_id);
    added++;
  }
  
  await rSet('prospect:list', all);
  return { added, skipped, alreadyConnected, alreadyInvited };
}

export async function updateProspect(id: string, updates: Partial<Prospect>): Promise<Prospect | null> {
  const all = await rGet<Prospect[]>('prospect:list', []);
  const idx = all.findIndex(p => p.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...updates, updated_at: new Date().toISOString() };
  await rSet('prospect:list', all);
  return all[idx];
}

export async function updateProspectByProviderId(providerId: string, updates: Partial<Prospect>): Promise<Prospect | null> {
  const all = await rGet<Prospect[]>('prospect:list', []);
  const idx = all.findIndex(p => p.provider_id === providerId);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...updates, updated_at: new Date().toISOString() };
  await rSet('prospect:list', all);
  return all[idx];
}

export async function removeProspect(id: string): Promise<boolean> {
  const all = await rGet<Prospect[]>('prospect:list', []);
  const filtered = all.filter(p => p.id !== id);
  if (filtered.length === all.length) return false;
  await rSet('prospect:list', filtered);
  return true;
}

export async function getProspectStats(): Promise<Record<ProspectStatus, number>> {
  const all = await rGet<Prospect[]>('prospect:list', []);
  const stats: Record<ProspectStatus, number> = {
    imported: 0, enriched: 0, invite_sent: 0, connected: 0, draft_created: 0, messaged: 0, rejected: 0,
  };
  all.forEach(p => { stats[p.status]++; });
  return stats;
}

// ============================================
// INVITE TRACKING — Redis persisted
// ============================================
export async function getInvitesSentToday(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const all = await rGet<Prospect[]>('prospect:list', []);
  return all.filter(p => p.invite_sent_at?.startsWith(today)).length;
}

export async function getSearchesToday(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const count = await rGet<{ date: string; count: number }>('prospect:search_count', { date: '', count: 0 });
  return count.date === today ? count.count : 0;
}

export async function incrementSearchCount(profilesFetched: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const current = await rGet<{ date: string; count: number }>('prospect:search_count', { date: '', count: 0 });
  if (current.date === today) {
    current.count += profilesFetched;
  } else {
    current.date = today;
    current.count = profilesFetched;
  }
  await rSet('prospect:search_count', current);
}
