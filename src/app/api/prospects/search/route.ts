import { NextRequest, NextResponse } from 'next/server';
import { searchLinkedIn, searchResultToProspect } from '@/lib/unipile';
import { addProspectsBulk, incrementSearchCount, getSearchesToday } from '@/lib/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

const MAX_PROFILES_PER_DAY = 2500;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, keywords, maxResults = 25 } = body;
    
    console.log('[Prospects Search] Request:', { url: url?.substring(0, 80), keywords, maxResults });
    console.log('[Prospects Search] ENV check — DSN:', !!process.env.UNIPILE_DSN, 'KEY:', !!process.env.UNIPILE_API_KEY, 'ACCOUNT:', !!process.env.UNIPILE_ACCOUNT_ID);

    if (!url && !keywords) {
      return NextResponse.json({ error: 'Provide url or keywords' }, { status: 400, headers: corsHeaders });
    }

    if (!process.env.UNIPILE_DSN || !process.env.UNIPILE_API_KEY || !process.env.UNIPILE_ACCOUNT_ID) {
      return NextResponse.json({ 
        error: 'Unipile not configured',
        details: { dsn: !!process.env.UNIPILE_DSN, apiKey: !!process.env.UNIPILE_API_KEY, accountId: !!process.env.UNIPILE_ACCOUNT_ID }
      }, { status: 500, headers: corsHeaders });
    }

    let searchesToday = 0;
    try { searchesToday = await getSearchesToday(); } catch {}
    
    if (searchesToday >= MAX_PROFILES_PER_DAY) {
      return NextResponse.json({ 
        error: 'Daily search limit reached (' + searchesToday + '/' + MAX_PROFILES_PER_DAY + '). Try again tomorrow.' 
      }, { status: 429, headers: corsHeaders });
    }
    
    const remaining = Math.min(maxResults, MAX_PROFILES_PER_DAY - searchesToday);
    
    console.log('[Prospects Search] Calling Unipile...');
    const results = await searchLinkedIn({ url, keywords });
    
    console.log('[Prospects Search] Got', results.items?.length || 0, 'items');
    
    const allItems = [...(results.items || []).slice(0, remaining)];
    let cursor = results.cursor;
    let pagesLoaded = 1;
    
    while (cursor && allItems.length < remaining && pagesLoaded < 10) {
      await new Promise(r => setTimeout(r, 10000 + Math.random() * 5000));
      const nextPage = await searchLinkedIn({ url, cursor });
      allItems.push(...(nextPage.items || []).slice(0, remaining - allItems.length));
      cursor = nextPage.cursor;
      pagesLoaded++;
    }
    
    // Convert to prospects — detect already-invited and already-connected from search results!
    const prospectData = allItems.map(item => {
      const prospect = searchResultToProspect(item, 'sales_navigator', url || keywords);
      
      // Unipile search results include these fields:
      // - network_distance: "DISTANCE_1" = already connected
      // - pending_invitation: true = invite already sent
      if (item.network_distance === 'DISTANCE_1') {
        (prospect as any)._autoStatus = 'connected';
      } else if (item.pending_invitation) {
        (prospect as any)._autoStatus = 'invite_sent';
      }
      
      return prospect;
    });
    
    const { added, skipped, alreadyConnected, alreadyInvited } = await addProspectsBulk(prospectData);
    try { await incrementSearchCount(allItems.length); } catch {}
    
    return NextResponse.json({
      success: true,
      total_found: results.paging?.total_count || allItems.length,
      fetched: allItems.length,
      added,
      skipped,
      already_connected: alreadyConnected || 0,
      already_invited: alreadyInvited || 0,
      pages_loaded: pagesLoaded,
      has_more: !!cursor,
    }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[Prospects Search] ERROR:', error.message, error.stack);
    return NextResponse.json({ 
      error: error.message,
      hint: error.cause ? String(error.cause) : undefined,
    }, { status: 500, headers: corsHeaders });
  }
}
