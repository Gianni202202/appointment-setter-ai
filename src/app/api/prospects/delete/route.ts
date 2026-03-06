import { NextRequest, NextResponse } from 'next/server';
import { removeProspect, getProspects } from '@/lib/database';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const { prospect_ids, deleteAll } = await request.json();
    
    if (deleteAll) {
      const all = await getProspects();
      let removed = 0;
      for (const p of all) {
        const ok = await removeProspect(p.id);
        if (ok) removed++;
      }
      return NextResponse.json({ success: true, removed }, { headers: corsHeaders });
    }
    
    if (!prospect_ids || prospect_ids.length === 0) {
      return NextResponse.json({ error: 'Provide prospect_ids or deleteAll' }, { status: 400, headers: corsHeaders });
    }
    
    let removed = 0;
    for (const id of prospect_ids) {
      const ok = await removeProspect(id);
      if (ok) removed++;
    }
    
    return NextResponse.json({ success: true, removed }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
