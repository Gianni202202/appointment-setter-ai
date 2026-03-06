import { NextRequest, NextResponse } from 'next/server';
import { getProspect, getProspects, updateProspect, getInvitesSentToday } from '@/lib/database';
import { sendInvitation, randomDelay } from '@/lib/unipile';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export const maxDuration = 300; // 5 min — slow on purpose

const MAX_INVITES_PER_DAY = 25; // Conservative safety limit

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prospect_ids } = body;
    
    // If no IDs given, send all enriched prospects that have a message ready
    let toSend;
    if (prospect_ids && prospect_ids.length > 0) {
      const all = await getProspects();
      toSend = all.filter(p => prospect_ids.includes(p.id) && p.status === 'enriched' && p.invite_message);
    } else {
      toSend = (await getProspects('enriched')).filter(p => p.invite_message);
    }
    
    // Check daily limit
    const sentToday = await getInvitesSentToday();
    const remaining = Math.min(toSend.length, MAX_INVITES_PER_DAY - sentToday);
    
    if (remaining <= 0) {
      return NextResponse.json({ 
        error: sentToday >= MAX_INVITES_PER_DAY 
          ? 'Daily invite limit reached (' + sentToday + '/' + MAX_INVITES_PER_DAY + '). Try again tomorrow.'
          : 'No enriched prospects with messages ready to send.',
        sent_today: sentToday,
      }, { status: 429, headers: corsHeaders });
    }
    
    toSend = toSend.slice(0, remaining);
    
    const results: { id: string; name: string; success: boolean; delay?: number; error?: string }[] = [];
    
    for (let i = 0; i < toSend.length; i++) {
      const prospect = toSend[i];
      
      try {
        const result = await sendInvitation(prospect.provider_id, prospect.invite_message);
        
        if (result.success) {
          await updateProspect(prospect.id, {
            status: 'invite_sent',
            invite_sent_at: new Date().toISOString(),
          });
          results.push({ id: prospect.id, name: prospect.name, success: true });
          console.log('[Invite] ✅ ' + (i+1) + '/' + toSend.length + ' — ' + prospect.name + ' invited');
        } else {
          results.push({ id: prospect.id, name: prospect.name, success: false, error: result.error });
          console.log('[Invite] ❌ ' + prospect.name + ': ' + result.error);
          
          // If LinkedIn limit hit, stop sending
          if (result.error?.includes('cannot_resend_yet') || result.error?.includes('Rate limited')) {
            console.log('[Invite] ⛔ LinkedIn limit reached, stopping batch');
            break;
          }
        }
      } catch (error: any) {
        results.push({ id: prospect.id, name: prospect.name, success: false, error: error.message });
      }
      
      // ── Human-like delay: random 50-70 seconds ──
      if (i < toSend.length - 1) {
        const delay = 50000 + Math.floor(Math.random() * 20000); // 50-70s
        console.log('[Invite] ⏳ Waiting ' + (delay/1000).toFixed(0) + 's before next invite...');
        await new Promise(r => setTimeout(r, delay));
      }
    }
    
    const sent = results.filter(r => r.success).length;
    return NextResponse.json({ 
      success: true, 
      sent, 
      failed: results.filter(r => !r.success).length,
      total: toSend.length,
      sent_today: sentToday + sent,
      daily_limit: MAX_INVITES_PER_DAY,
      results,
    }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[Invite Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
