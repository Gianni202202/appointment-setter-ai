import { NextResponse } from 'next/server';
import { getConversation, addMessage, updateConversationState, getConfig } from '@/lib/database';
import { generateResponse } from '@/lib/claude';
import { getNextState } from '@/lib/state-machine';
import { sendMessage } from '@/lib/unipile';

export async function POST(request: Request) {
  try {
    const { conversation_id } = await request.json();

    const conversation = getConversation(conversation_id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const config = getConfig();

    // Generate AI response using the correct function signature
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

    // Add AI message to database
    const message = addMessage({
      conversation_id: conversation.id,
      role: 'agent',
      content: aiResponse.message,
      reasoning: aiResponse.reasoning,
      sent_at: new Date().toISOString(),
      is_read: false,
    });

    // Update conversation state based on AI analysis
    const nextState = getNextState(
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

    if (nextState !== conversation.state) {
      updateConversationState(conversation.id, nextState);
    }

    // Send via Unipile (only if DSN and API key are set)
    let unipileSent = false;
    if (process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY && aiResponse.should_respond) {
      try {
        await sendMessage(conversation.unipile_chat_id, aiResponse.message);
        unipileSent = true;
      } catch (err) {
        console.error('Failed to send via Unipile:', err);
      }
    }

    return NextResponse.json({
      success: true,
      message,
      reasoning: aiResponse.reasoning,
      new_state: nextState,
      unipile_sent: unipileSent,
      needs_human: aiResponse.needs_human,
    });
  } catch (error) {
    console.error('Agent respond error:', error);
    return NextResponse.json(
      { error: 'Failed to generate response', details: String(error) },
      { status: 500 }
    );
  }
}
