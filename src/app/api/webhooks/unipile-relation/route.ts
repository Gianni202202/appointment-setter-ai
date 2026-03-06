import { NextRequest, NextResponse } from 'next/server';
import { updateProspectByProviderId, logActivity, getConfigAsync, addDraft } from '@/lib/database';
import { generateResponse } from '@/lib/claude';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[Webhook] new_relation event:', JSON.stringify(body));
    
    const { event, user_provider_id, user_full_name, user_public_identifier, user_profile_url, user_picture_url } = body;
    
    if (event !== 'new_relation') {
      return NextResponse.json({ ok: true, message: 'Ignored non-relation event' });
    }
    
    if (!user_provider_id) {
      return NextResponse.json({ ok: true, message: 'No provider_id in event' });
    }
    
    // Update prospect status to connected
    const updated = await updateProspectByProviderId(user_provider_id, {
      status: 'connected',
      connected_at: new Date().toISOString(),
    });
    
    if (updated) {
      await logActivity('reply_received', user_full_name || 'Unknown', {
        type: 'invitation_accepted',
        provider_id: user_provider_id,
        public_identifier: user_public_identifier,
      });
      
      console.log('[Webhook] Prospect updated to connected:', updated.name);
      
      // Auto-generate a follow-up draft if the prospect was tracked
      try {
        const config = await getConfigAsync();
        const response = await generateResponse(
          config,
          'new',
          [], // No messages yet — fresh connection
          { name: updated.name, headline: updated.headline, company: updated.company },
          undefined,
          'Dit is een net geaccepteerd connectieverzoek. Schrijf een persoonlijk eerste bericht als follow-up.',
        );
        
        if (response.message && response.should_respond !== false) {
          await addDraft({
            chat_id: 'pending_' + user_provider_id, // Will be linked when chat appears
            prospect_name: updated.name,
            prospect_headline: updated.headline,
            message: response.message,
            reasoning: response.reasoning || 'Auto-generated follow-up for accepted invite',
            phase: response.phase,
            confidence: response.confidence,
          });
          
          await updateProspectByProviderId(user_provider_id, { status: 'draft_created' });
          console.log('[Webhook] Auto-draft created for:', updated.name);
        }
      } catch (draftError) {
        console.error('[Webhook] Auto-draft generation failed:', draftError);
        // Non-fatal — prospect is still marked as connected
      }
    } else {
      console.log('[Webhook] No matching prospect for provider_id:', user_provider_id);
    }
    
    return NextResponse.json({ ok: true, prospect_updated: !!updated });
  } catch (error: any) {
    console.error('[Webhook] Relation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
