import { Conversation, Message, AgentConfig, ConversationState, DashboardMetrics } from '@/types';

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

// GLOBAL AGENT TOGGLE — starts OFF for safety
let globalAgentEnabled = false;

// ============================================
// Global Agent Toggle
// ============================================

export function isAgentEnabled(): boolean {
  return globalAgentEnabled;
}

export function setAgentEnabled(enabled: boolean): void {
  globalAgentEnabled = enabled;
  console.log(`[Agent] Global agent ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

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
