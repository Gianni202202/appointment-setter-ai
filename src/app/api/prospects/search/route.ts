import { NextRequest, NextResponse } from 'next/server';
import { searchLinkedIn, searchResultToProspect } from '@/lib/unipile';
import { addProspectsBulk, incrementSearchCount, getSearchesToday } from '@/lib/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_PROFILES_PER_DAY = 2500;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, keywords, maxResults = 25 } = body;
    
    if (!url && !keywords) {
      return NextResponse.json({ error: 'Provide url or keywords' }, { status: 400 });
    }
    
    // Check daily limit
    const searchesToday = await getSearchesToday();
    if (searchesToday >= MAX_PROFILES_PER_DAY) {
      return NextResponse.json({ 
        error: `Daily search limit reached (${searchesToday}/${MAX_PROFILES_PER_DAY}). Try again tomorrow.` 
      }, { status: 429 });
    }
    
    const remaining = Math.min(maxResults, MAX_PROFILES_PER_DAY - searchesToday);
    
    // First page
    const results = await searchLinkedIn({ url, keywords });
    const allItems = [...results.items.slice(0, remaining)];
    let cursor = results.cursor;
    let pagesLoaded = 1;
    
    // Paginate if needed (with delays!)
    while (cursor && allItems.length < remaining && pagesLoaded < 10) {
      // Random delay 10-15s between pages (safe interval)
      await new Promise(r => setTimeout(r, 10000 + Math.random() * 5000));
      
      const nextPage = await searchLinkedIn({ url, cursor });
      allItems.push(...nextPage.items.slice(0, remaining - allItems.length));
      cursor = nextPage.cursor;
      pagesLoaded++;
    }
    
    // Convert to prospects and save
    const prospectData = allItems.map(item => 
      searchResultToProspect(item, 'sales_navigator', url || keywords)
    );
    
    const { added, skipped } = await addProspectsBulk(prospectData);
    await incrementSearchCount(allItems.length);
    
    return NextResponse.json({
      success: true,
      total_found: results.paging?.total_count || allItems.length,
      fetched: allItems.length,
      added,
      skipped,
      pages_loaded: pagesLoaded,
      has_more: !!cursor,
    });
  } catch (error: any) {
    console.error('[Prospects Search]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
