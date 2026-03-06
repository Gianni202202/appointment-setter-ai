import { NextRequest, NextResponse } from 'next/server';
import { addProspectsBulk } from '@/lib/database';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}


export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prospects } = body;
    
    if (!prospects || !Array.isArray(prospects) || prospects.length === 0) {
      return NextResponse.json({ error: 'Provide prospects array' }, { status: 400, headers: corsHeaders });
    }
    
    // Validate and clean prospect data from Chrome extension
    const cleaned = prospects.map((p: any) => ({
      provider_id: p.provider_id || p.id || p.member_urn || '',
      public_identifier: p.public_identifier || '',
      name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
      first_name: p.first_name || '',
      last_name: p.last_name || '',
      headline: p.headline || '',
      company: p.current_positions?.[0]?.company || p.company || '',
      location: p.location || '',
      profile_url: p.profile_url || '',
      profile_picture_url: p.profile_picture_url || '',
      network_distance: p.network_distance || '',
      source: 'sales_navigator' as const,
      search_query: p.search_query || '',
    })).filter((p: any) => p.provider_id);
    
    const { added, skipped } = await addProspectsBulk(cleaned);
    
    return NextResponse.json({ success: true, added, skipped, total: cleaned.length }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[Prospects Import]', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
