import { Conversation, Message, AgentConfig, ConversationState, DashboardMetrics } from '@/types';

// ============================================
// In-Memory Database (replace with Supabase later)
// For MVP, we store data in memory + JSON files
// ============================================

let conversations: Conversation[] = [];
let allMessages: Message[] = [];

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

// ============================================
// Message CRUD
// ============================================

export function addMessage(data: Omit<Message, 'id'>): Message {
  const msg: Message = {
    ...data,
    id: crypto.randomUUID(),
  };
  allMessages.push(msg);

  // Update conversation last_message_at
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
    total_conversations: total,
    active_conversations: active,
    reply_rate: total > 0 ? Math.round((withReplies / total) * 100) : 0,
    meetings_booked: booked,
    avg_response_time_minutes: 0,
    conversations_by_state: stateCount,
  };
}

// ============================================
// Demo Data
// ============================================

export function seedDemoData(): void {
  // Don't seed if already has data
  if (conversations.length > 0) return;

  const demoConversations: Conversation[] = [
    {
      id: 'demo-1',
      unipile_chat_id: 'unipile-chat-001',
      prospect_name: 'Mark de Vries',
      prospect_headline: 'CEO at ScaleUp BV | Helping SaaS companies grow',
      prospect_company: 'ScaleUp BV',
      prospect_avatar_url: '',
      state: 'engaged',
      icp_score: 85,
      auto_respond: true,
      last_message_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: new Date(Date.now() - 86400000).toISOString(),
      updated_at: new Date(Date.now() - 3600000).toISOString(),
      messages: [],
    },
    {
      id: 'demo-2',
      unipile_chat_id: 'unipile-chat-002',
      prospect_name: 'Sophie Jansen',
      prospect_headline: 'Head of Growth at TechFlow | B2B Marketing Expert',
      prospect_company: 'TechFlow',
      prospect_avatar_url: '',
      state: 'qualified',
      icp_score: 92,
      auto_respond: true,
      last_message_at: new Date(Date.now() - 7200000).toISOString(),
      created_at: new Date(Date.now() - 172800000).toISOString(),
      updated_at: new Date(Date.now() - 7200000).toISOString(),
      messages: [],
    },
    {
      id: 'demo-3',
      unipile_chat_id: 'unipile-chat-003',
      prospect_name: 'Thomas Bakker',
      prospect_headline: 'Founder & CTO at DataDriven | AI & Analytics',
      prospect_company: 'DataDriven',
      prospect_avatar_url: '',
      state: 'objection',
      icp_score: 78,
      auto_respond: false,
      last_message_at: new Date(Date.now() - 14400000).toISOString(),
      created_at: new Date(Date.now() - 259200000).toISOString(),
      updated_at: new Date(Date.now() - 14400000).toISOString(),
      messages: [],
    },
    {
      id: 'demo-4',
      unipile_chat_id: 'unipile-chat-004',
      prospect_name: 'Lisa van den Berg',
      prospect_headline: 'VP Sales at CloudFirst | Enterprise SaaS',
      prospect_company: 'CloudFirst',
      prospect_avatar_url: '',
      state: 'booked',
      icp_score: 95,
      auto_respond: false,
      last_message_at: new Date(Date.now() - 28800000).toISOString(),
      created_at: new Date(Date.now() - 432000000).toISOString(),
      updated_at: new Date(Date.now() - 28800000).toISOString(),
      messages: [],
    },
    {
      id: 'demo-5',
      unipile_chat_id: 'unipile-chat-005',
      prospect_name: 'Pieter Hendriks',
      prospect_headline: 'Director at OldSchool Corporate | Traditional Industry',
      prospect_company: 'OldSchool Corporate',
      prospect_avatar_url: '',
      state: 'dead',
      icp_score: 35,
      auto_respond: false,
      last_message_at: new Date(Date.now() - 604800000).toISOString(),
      created_at: new Date(Date.now() - 864000000).toISOString(),
      updated_at: new Date(Date.now() - 604800000).toISOString(),
      messages: [],
    },
  ];

  const demoMessages: Message[] = [
    // Conversation 1 - Engaged
    { id: 'msg-1a', conversation_id: 'demo-1', role: 'agent', content: 'Hey Mark, zag je recente post over SaaS-groei in de Benelux. Interessante take. Hoe gaan jullie om met outbound op dit moment?', sent_at: new Date(Date.now() - 86400000).toISOString(), is_read: true },
    { id: 'msg-1b', conversation_id: 'demo-1', role: 'prospect', content: 'Thanks Gianni! We doen nu vooral inbound maar merken dat we daar een plafond bereiken. Outbound is iets waar we naar kijken.', sent_at: new Date(Date.now() - 43200000).toISOString(), is_read: true },
    { id: 'msg-1c', conversation_id: 'demo-1', role: 'agent', content: 'Herkenbaar. Veel SaaS-bedrijven in jullie fase zien dat inbound plateaut rond series A. Wat is jullie biggest bottleneck — is het lead volume of conversie?', reasoning: 'Mark shows clear interest in outbound. Moving to qualify by understanding their specific pain point.', sent_at: new Date(Date.now() - 3600000).toISOString(), is_read: false },

    // Conversation 2 - Qualified
    { id: 'msg-2a', conversation_id: 'demo-2', role: 'agent', content: 'Hey Sophie, viel me op dat TechFlow recent flink gegroeid is. Gefeliciteerd! Welke groeikanalen werken het best voor jullie?', sent_at: new Date(Date.now() - 172800000).toISOString(), is_read: true },
    { id: 'msg-2b', conversation_id: 'demo-2', role: 'prospect', content: 'Dankje! LinkedIn en content marketing vooral. Maar we willen nu ook outbound opschalen.', sent_at: new Date(Date.now() - 129600000).toISOString(), is_read: true },
    { id: 'msg-2c', conversation_id: 'demo-2', role: 'agent', content: 'Nice combo. Outbound met een sterke content-basis kan heel krachtig zijn. We helpen vergelijkbare bedrijven daar een systeem voor opzetten. Zou je open staan voor een kort gesprek daarover?', sent_at: new Date(Date.now() - 86400000).toISOString(), is_read: true },
    { id: 'msg-2d', conversation_id: 'demo-2', role: 'prospect', content: 'Ja, klinkt interessant. Volgende week heb ik donderdag of vrijdag ruimte.', sent_at: new Date(Date.now() - 7200000).toISOString(), is_read: true },

    // Conversation 3 - Objection
    { id: 'msg-3a', conversation_id: 'demo-3', role: 'agent', content: 'Hey Thomas, indrukwekkend wat jullie met DataDriven aan het bouwen zijn. Hoe benaderen jullie nieuwe klanten op dit moment?', sent_at: new Date(Date.now() - 259200000).toISOString(), is_read: true },
    { id: 'msg-3b', conversation_id: 'demo-3', role: 'prospect', content: 'We hebben eigenlijk al een sales automation tool draaien. Apollo.io. Werkt prima voor ons.', sent_at: new Date(Date.now() - 14400000).toISOString(), is_read: true },

    // Conversation 4 - Booked
    { id: 'msg-4a', conversation_id: 'demo-4', role: 'agent', content: 'Hey Lisa, CloudFirst groeit als een raket zie ik. Hoe houden jullie de pipeline gevuld bij die groei?', sent_at: new Date(Date.now() - 432000000).toISOString(), is_read: true },
    { id: 'msg-4b', conversation_id: 'demo-4', role: 'prospect', content: 'Dat is inderdaad de uitdaging haha. We zoeken actief naar betere manieren.', sent_at: new Date(Date.now() - 345600000).toISOString(), is_read: true },
    { id: 'msg-4c', conversation_id: 'demo-4', role: 'agent', content: 'Snap ik. We werken met een paar enterprise SaaS-bedrijven die dezelfde challenge hadden. Zal ik je laten zien hoe ze dat opgelost hebben?', sent_at: new Date(Date.now() - 259200000).toISOString(), is_read: true },
    { id: 'msg-4d', conversation_id: 'demo-4', role: 'prospect', content: 'Ja graag! Kan je dinsdag om 10:00?', sent_at: new Date(Date.now() - 172800000).toISOString(), is_read: true },
    { id: 'msg-4e', conversation_id: 'demo-4', role: 'agent', content: 'Perfect, dinsdag 10:00 staat. Ik stuur je een agenda-invite. Kijk uit naar het gesprek, Lisa!', sent_at: new Date(Date.now() - 28800000).toISOString(), is_read: true },
  ];

  conversations = demoConversations;
  allMessages = demoMessages;
}

// Initialize with demo data
seedDemoData();
