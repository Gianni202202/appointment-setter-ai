import { NextRequest, NextResponse } from 'next/server';
import { getProspects, updateProspect, getInvitesSentToday } from '@/lib/database';
import { sendInvitation } from '@/lib/unipile';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

const MAX_INVITES_PER_DAY = 25;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prospect_ids } = body;
    
    const sentToday = await getInvitesSentToday();
    console.log('[Invite] Sent today:', sentToday, '/', MAX_INVITES_PER_DAY);
    
    if (sentToday >= MAX_INVITES_PER_DAY) {
      return NextResponse.json({ 
        error: 'Daily invite limit reached (' + sentToday + '/' + MAX_INVITES_PER_DAY + '). Try again tomorrow.',
        sent_today: sentToday,
        daily_limit: MAX_INVITES_PER_DAY,
      }, { status: 429, headers: corsHeaders });
    }
    
    // Get enriched prospects with messages
    let toSend;
    if (prospect_ids && prospect_ids.length > 0) {
      const all = await getProspects();
      toSend = all.filter((p: any) => prospect_ids.includes(p.id) && p.status === 'enriched' && p.invite_message);
    } else {
      toSend = (await getProspects('enriched')).filter((p: any) => p.invite_message);
    }
    
    const maxCanSend = MAX_INVITES_PER_DAY - sentToday;
    toSend = toSend.slice(0, maxCanSend);
    
    if (toSend.length === 0) {
      return NextResponse.json({ 
        success: true, sent: 0, 
        message: 'No enriched prospects with messages ready to send' 
      }, { headers: corsHeaders });
    }
    
    console.log('[Invite] Sending', toSend.length, 'invitations...');
    
    const results: { id: string; name: string; success: boolean; error?: string }[] = [];
    
    for (let i = 0; i < toSend.length; i++) {
      const prospect = toSend[i];
      
      try {
        console.log('[Invite]', (i + 1) + '/' + toSend.length, 'Sending to:', prospect.name);
        
        const result = await sendInvitation(
          prospect.provider_id, 
          prospect.invite_message
        );
        
        if (result.success) {
          await updateProspect(prospect.id, {
            status: 'invite_sent',
            invite_sent_at: new Date().toISOString(),
          });
          results.push({ id: prospect.id, name: prospect.name, success: true });
          console.log('[Invite] ✅', prospect.name, 'sent');
        } else {
          console.error('[Invite] ❌', prospect.name, ':', result.error);
          results.push({ id: prospect.id, name: prospect.name, success: false, error: result.error });
        }
      } catch (error: any) {
        console.error('[Invite] ❌', prospect.name, ':', error.message);
        results.push({ id: prospect.id, name: prospect.name, success: false, error: error.message });
      }
      
      // Human-like delay: random 50-70s between invites
      if (i < toSend.length - 1) {
        const delay = 50000 + Math.floor(Math.random() * 20000);
        console.log('[Invite] ⏳ Waiting', (delay/1000).toFixed(0) + 's before next...');
        await new Promise(r => setTimeout(r, delay));
      }
    }
    
    const sent = results.filter(r => r.success).length;
    return NextResponse.json({
      success: true,
      sent,
      failed: results.length - sent,
      total: toSend.length,
      sent_today: sentToday + sent,
      daily_limit: MAX_INVITES_PER_DAY,
      results,
    }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[Invite Error]', error.message, error.stack);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
