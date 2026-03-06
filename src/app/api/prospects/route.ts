import { NextRequest, NextResponse } from 'next/server';
import { getProspects, getProspectStats } from '@/lib/database';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as any;
    const statsOnly = searchParams.get('stats') === 'true';
    
    if (statsOnly) {
      const stats = await getProspectStats();
      return NextResponse.json({ stats });
    }
    
    const prospects = await getProspects(status || undefined);
    const stats = await getProspectStats();
    
    return NextResponse.json({
      prospects: prospects.sort((a, b) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      ),
      stats,
      total: prospects.length,
    });
  } catch (error: any) {
    console.error('[Prospects GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
