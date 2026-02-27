import { NextResponse } from 'next/server';
import { getConversation, getConfig } from '@/lib/database';
import { generateResponse } from '@/lib/claude';
import { getNextState } from '@/lib/state-machine';

/**
 * TEST MODE — generates a response WITHOUT sending it.
 * Shows you exactly what the AI would say + its reasoning.
 * Nothing gets sent to LinkedIn. Nothing gets saved.
 */
export async function POST(request: Request) {
  try {
    const { conversation_id } = await request.json();

    const conversation = getConversation(conversation_id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const config = getConfig();

    // Check if Claude API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({
        test_mode: true,
        warning: 'ANTHROPIC_API_KEY not set — using mock response',
        preview: {
          message: `Hey ${conversation.prospect_name.split(' ')[0]}, zag je profiel en viel me op dat je bij ${conversation.prospect_company} werkt. Hoe gaan jullie om met outbound op dit moment?`,
          reasoning: '[MOCK] This is a test response. Set ANTHROPIC_API_KEY for real AI responses.',
          sentiment: 'neutral',
          would_send: true,
        },
        current_state: conversation.state,
        suggested_state: conversation.state,
        conversation_name: conversation.prospect_name,
      });
    }

    const aiResponse = await generateResponse(
      config,
      conversation.state,
      conversation.messages,
      {
        name: conversation.prospect_name,
        headline: conversation.prospect_headline,
        company: conversation.prospect_company,
      }
    );

    // Calculate what the next state WOULD be
    const suggestedState = getNextState(
      conversation.state,
      conversation.messages,
      {
        sentiment: aiResponse.sentiment,
        hasObjection: aiResponse.has_objection,
        objectionType: aiResponse.objection_type as any,
        meetingMentioned: aiResponse.meeting_mentioned,
        notInterested: aiResponse.not_interested,
      }
    );

    return NextResponse.json({
      test_mode: true,
      nothing_sent: true,
      preview: {
        message: aiResponse.message,
        reasoning: aiResponse.reasoning,
        sentiment: aiResponse.sentiment,
        would_send: aiResponse.should_respond && !aiResponse.needs_human,
        needs_human: aiResponse.needs_human,
        reason_if_no_send: aiResponse.reason_for_no_response,
      },
      current_state: conversation.state,
      suggested_state: suggestedState,
      state_would_change: suggestedState !== conversation.state,
      conversation_name: conversation.prospect_name,
    });
  } catch (error) {
    console.error('[Test Mode] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
