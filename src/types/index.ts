// ============================================
// Conversation & Message Types
// ============================================

export type ConversationState =
  | 'new'
  | 'engaged'
  | 'objection'
  | 'qualified'
  | 'booked'
  | 'dead'
  | 'handoff';

export interface Conversation {
  id: string;
  unipile_chat_id: string;
  prospect_name: string;
  prospect_headline: string;
  prospect_company: string;
  prospect_avatar_url: string;
  state: ConversationState;
  icp_score: number;
  auto_respond: boolean;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  messages: Message[];
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'prospect' | 'agent' | 'human';
  content: string;
  reasoning?: string;
  sent_at: string;
  is_read: boolean;
}

// ============================================
// Agent Configuration Types
// ============================================

export interface AgentConfig {
  icp: ICPConfig;
  tone: ToneConfig;
  rules: RulesConfig;
  blacklist: string[];
}

export interface ICPConfig {
  industries: string[];
  roles: string[];
  company_size_min: number;
  company_size_max: number;
  keywords: string[];
  description: string;
}

export interface ToneConfig {
  style: 'professional' | 'casual' | 'friendly' | 'authoritative';
  language: 'en' | 'nl' | 'de';
  max_message_length: number;
  first_person_name: string;
  example_messages: string[];
}

export interface RulesConfig {
  no_links_first_touch: boolean;
  no_calendar_first_touch: boolean;
  max_follow_ups: number;
  follow_up_delay_hours: number;
  auto_respond: boolean;
  working_hours_start: number;
  working_hours_end: number;
  goal: string;
  offer_description: string;
}

// ============================================
// Unipile API Types
// ============================================

export interface UnipileChat {
  id: string;
  account_id: string;
  attendees: UnipileAttendee[];
  last_message?: {
    text: string;
    timestamp: string;
    sender_id: string;
  };
}

export interface UnipileAttendee {
  id: string;
  name: string;
  headline?: string;
  avatar_url?: string;
  provider_id?: string;
}

export interface UnipileMessage {
  id: string;
  chat_id: string;
  text: string;
  sender_id: string;
  timestamp: string;
  is_sender: boolean;
  attachments?: UnipileAttachment[];
}

export interface UnipileAttachment {
  id: string;
  name: string;
  url: string;
  type: string;
}

export interface UnipileWebhookEvent {
  event: string;
  data: {
    id: string;
    chat_id: string;
    text?: string;
    sender_id?: string;
    timestamp?: string;
    account_id?: string;
  };
}

// ============================================
// Dashboard / Metrics Types
// ============================================

export interface DashboardMetrics {
  total_conversations: number;
  active_conversations: number;
  reply_rate: number;
  meetings_booked: number;
  avg_response_time_minutes: number;
  conversations_by_state: Record<ConversationState, number>;
}
