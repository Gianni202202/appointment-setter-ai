import { ConversationState, Message } from '@/types';

// ============================================
// State Transition Rules
// ============================================

interface StateTransition {
  from: ConversationState;
  to: ConversationState;
  condition: string;
}

const TRANSITIONS: StateTransition[] = [
  { from: 'new', to: 'engaged', condition: 'prospect_replied' },
  { from: 'new', to: 'dead', condition: 'no_response_after_max_followups' },
  { from: 'engaged', to: 'qualified', condition: 'positive_interest_detected' },
  { from: 'engaged', to: 'objection', condition: 'objection_detected' },
  { from: 'engaged', to: 'dead', condition: 'not_interested' },
  { from: 'objection', to: 'engaged', condition: 'objection_resolved' },
  { from: 'objection', to: 'dead', condition: 'strong_rejection' },
  { from: 'qualified', to: 'booked', condition: 'meeting_confirmed' },
  { from: 'qualified', to: 'handoff', condition: 'needs_human_attention' },
  { from: 'qualified', to: 'dead', condition: 'went_cold' },
];

// ============================================
// Objection Types
// ============================================

export type ObjectionType =
  | 'authority'    // "I'm not the right person"
  | 'timing'       // "Not right now"
  | 'overlap'      // "We already have a solution"
  | 'skepticism'   // "How is this different from X?"
  | 'indifference' // "Not interested"
  | 'price';       // "Too expensive"

// ============================================
// State Machine Logic
// ============================================

export function getNextState(
  currentState: ConversationState,
  messages: Message[],
  aiAnalysis: {
    sentiment: 'positive' | 'neutral' | 'negative';
    hasObjection: boolean;
    objectionType?: ObjectionType;
    meetingMentioned: boolean;
    notInterested: boolean;
  }
): ConversationState {
  // Human handoff for complex situations
  if (currentState === 'qualified' && aiAnalysis.hasObjection) {
    return 'handoff';
  }

  // Meeting booked
  if (aiAnalysis.meetingMentioned && aiAnalysis.sentiment === 'positive') {
    return 'booked';
  }

  // Clear rejection
  if (aiAnalysis.notInterested) {
    return 'dead';
  }

  // Objection detected
  if (aiAnalysis.hasObjection && currentState !== 'objection') {
    return 'objection';
  }

  // Positive reply
  if (aiAnalysis.sentiment === 'positive') {
    if (currentState === 'new') return 'engaged';
    if (currentState === 'engaged') return 'qualified';
    if (currentState === 'objection') return 'engaged';
  }

  return currentState;
}

export function shouldAutoRespond(state: ConversationState): boolean {
  const autoRespondStates: ConversationState[] = ['new', 'engaged', 'objection'];
  return autoRespondStates.includes(state);
}

export function getStateLabel(state: ConversationState): string {
  const labels: Record<ConversationState, string> = {
    new: '🆕 New',
    engaged: '💬 Engaged',
    objection: '⚡ Objection',
    qualified: '🎯 Qualified',
    booked: '📅 Booked',
    dead: '💀 Dead',
    handoff: '🙋 Handoff',
  };
  return labels[state];
}

export function getStateColor(state: ConversationState): string {
  const colors: Record<ConversationState, string> = {
    new: '#3B82F6',
    engaged: '#10B981',
    objection: '#F59E0B',
    qualified: '#8B5CF6',
    booked: '#06B6D4',
    dead: '#6B7280',
    handoff: '#EF4444',
  };
  return colors[state];
}

export { TRANSITIONS };
