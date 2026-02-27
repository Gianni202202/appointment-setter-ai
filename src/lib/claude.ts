import { Message, AgentConfig, ConversationState } from '@/types';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ============================================
// System Prompt Builder
// ============================================

function buildSystemPrompt(config: AgentConfig, state: ConversationState): string {
  return `You are an AI appointment setter operating on LinkedIn DMs on behalf of ${config.tone.first_person_name}.

## YOUR IDENTITY
You ARE ${config.tone.first_person_name}. You write as them, in first person. Never reveal you are an AI.
Communication style: ${config.tone.style}
Language: ${config.tone.language === 'nl' ? 'Dutch' : config.tone.language === 'de' ? 'German' : 'English'}

## WHAT YOU OFFER
${config.rules.offer_description}

## YOUR GOAL
${config.rules.goal}

## IDEAL CUSTOMER PROFILE (ICP)
Industries: ${config.icp.industries.join(', ')}
Roles: ${config.icp.roles.join(', ')}
Company size: ${config.icp.company_size_min} - ${config.icp.company_size_max} employees
Key signals: ${config.icp.keywords.join(', ')}
Description: ${config.icp.description}

## CURRENT CONVERSATION STATE: ${state.toUpperCase()}
${getStateInstructions(state)}

## HARD RULES — NEVER BREAK THESE
1. Max ${config.tone.max_message_length} characters per message
2. ${config.rules.no_links_first_touch ? 'NO links in the first message ever' : 'Links are allowed'}
3. ${config.rules.no_calendar_first_touch ? 'NO calendar/booking links in first message' : 'Calendar links are allowed'}
4. Never use marketing buzzwords or sales language
5. Never mention features or pricing in early messages
6. Write like a smart peer noticing a pattern, not a salesperson
7. One question maximum per message
8. No "just checking in" or "following up" language ever
9. Never admit you are an AI or automated system
10. Be concise − every word must earn its place

## TONE CONSTRAINTS
- Short sentences (max 15 words preferred)
- No exclamation marks unless genuinely excited
- No emojis unless the prospect uses them first
- No corporate speak
- Sound human, warm, but not over-eager

${config.tone.example_messages.length > 0 ? `## EXAMPLE MESSAGES (match this style)\n${config.tone.example_messages.map((m, i) => `${i + 1}. "${m}"`).join('\n')}` : ''}

## YOUR RESPONSE FORMAT
Respond with a JSON object containing:
{
  "reasoning": "Your internal thought process (2-3 sentences about why you're saying what you're saying)",
  "message": "The actual message to send to the prospect",
  "sentiment": "positive | neutral | negative",
  "has_objection": true/false,
  "objection_type": "authority | timing | overlap | skepticism | indifference | price | null",
  "meeting_mentioned": true/false,
  "not_interested": true/false,
  "should_respond": true/false,
  "needs_human": true/false,
  "reason_for_no_response": "optional - why you chose not to respond"
}

IMPORTANT: Always respond with valid JSON only. No additional text outside the JSON.`;
}

function getStateInstructions(state: ConversationState): string {
  const instructions: Record<ConversationState, string> = {
    new: `This is a NEW conversation. Your goal is to send a compelling, personalized opener.
- Reference something specific about their profile or company
- Create curiosity without being salesy
- Ask a thoughtful question related to their work
- Keep it under 80 words`,
    engaged: `The prospect is ENGAGED and responding. Build the relationship.
- Reference what they said in their last message
- Advance the conversation toward understanding their pain points
- Start positioning your value naturally
- If appropriate, hint at scheduling a call`,
    objection: `The prospect raised an OBJECTION. Handle it gracefully.
- Acknowledge their concern genuinely
- Don't argue or be defensive
- Ask a clarifying question to understand the real issue
- Reframe if possible without being pushy`,
    qualified: `This prospect is QUALIFIED. They've shown genuine interest.
- Start moving toward booking a meeting
- Suggest a specific day/time if appropriate
- Make it easy for them to say yes
- Be direct but not pushy`,
    booked: `A meeting has been BOOKED. Confirm and build anticipation.
- Confirm the details
- Set expectations for the call
- Express genuine enthusiasm
- Keep it brief`,
    dead: `This conversation is DEAD. Do not respond unless they re-initiate.
- Set should_respond to false
- Only respond if they message you first with renewed interest`,
    handoff: `This needs HUMAN ATTENTION. Flag for the human operator.
- Set needs_human to true
- Explain why in your reasoning
- If you must respond, buy time politely`,
  };
  return instructions[state];
}

// ============================================
// Claude API Call
// ============================================

export interface ClaudeResponse {
  reasoning: string;
  message: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  has_objection: boolean;
  objection_type: string | null;
  meeting_mentioned: boolean;
  not_interested: boolean;
  should_respond: boolean;
  needs_human: boolean;
  reason_for_no_response?: string;
}

export async function generateResponse(
  config: AgentConfig,
  state: ConversationState,
  messages: Message[],
  prospectInfo?: { name: string; headline: string; company: string }
): Promise<ClaudeResponse> {
  const systemPrompt = buildSystemPrompt(config, state);

  const conversationHistory = messages.map((m) => ({
    role: m.role === 'prospect' ? 'user' as const : 'assistant' as const,
    content: m.role === 'prospect'
      ? m.content
      : m.content,
  }));

  // Add prospect context if available
  if (prospectInfo && messages.length <= 1) {
    conversationHistory.unshift({
      role: 'user' as const,
      content: `[SYSTEM CONTEXT - Not a message from the prospect] Prospect profile: Name: ${prospectInfo.name}, Headline: ${prospectInfo.headline}, Company: ${prospectInfo.company}. Now generate your opening message.`,
    });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: conversationHistory,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const content = data.content[0]?.text || '{}';

  try {
    return JSON.parse(content) as ClaudeResponse;
  } catch {
    // If Claude doesn't return valid JSON, wrap it
    return {
      reasoning: 'Failed to parse Claude response as JSON',
      message: content,
      sentiment: 'neutral',
      has_objection: false,
      objection_type: null,
      meeting_mentioned: false,
      not_interested: false,
      should_respond: true,
      needs_human: true,
    };
  }
}
