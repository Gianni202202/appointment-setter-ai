import { NextRequest, NextResponse } from 'next/server';
import { updateProspect, getProspect } from '@/lib/database';

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
    const { prospect_id, invite_message } = await request.json();
    
    if (!prospect_id) {
      return NextResponse.json({ error: 'Provide prospect_id' }, { status: 400, headers: corsHeaders });
    }
    
    const updated = await updateProspect(prospect_id, { 
      invite_message: invite_message?.substring(0, 290),
    });
    
    if (!updated) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404, headers: corsHeaders });
    }
    
    return NextResponse.json({ success: true, prospect: updated }, { headers: corsHeaders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
