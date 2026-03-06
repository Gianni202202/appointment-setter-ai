import { NextRequest, NextResponse } from 'next/server';
import { getProspect, updateProspect, getConfigAsync } from '@/lib/database';
import { getProfile } from '@/lib/unipile';
import { generateResponse } from '@/lib/claude';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

const MAX_CHARS = 290;

export async function POST(request: NextRequest) {
  try {
    const { prospect_id, instruction } = await request.json();
    
    if (!prospect_id) {
      return NextResponse.json({ error: 'Provide prospect_id' }, { status: 400, headers: corsHeaders });
    }
    
    const prospect = await getProspect(prospect_id);
    if (!prospect) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404, headers: corsHeaders });
    }
    
    const finalInstruction = instruction || 'Schrijf een persoonlijk en relevant connectieverzoek. Refereer aan de rol, het bedrijf of de expertise van de prospect.';
    
    const config = await getConfigAsync();
    
    const prospectContext = [
      'Naam: ' + prospect.name,
      'Functie: ' + prospect.headline,
      'Bedrijf: ' + prospect.company,
      prospect.summary ? 'Over: ' + prospect.summary.substring(0, 200) : '',
    ].filter(Boolean).join('\n');
    
    const aiPrompt = [
      'Je bent een expert in het schrijven van authentieke LinkedIn connectieverzoeken.',
      '',
      'INSTRUCTIE: ' + finalInstruction,
      '',
      'PROFIEL:',
      prospectContext,
      '',
      'REGELS:',
      '- MAXIMAAL ' + MAX_CHARS + ' TEKENS (harde LinkedIn limiet)',
      '- Spreek aan met voornaam, persoonlijk en menselijk',
      '- Geen emoji, links, of verkooppraatjes',
      '- Nederlands tenzij profiel Engels is',
      '- Schrijf ALLEEN het bericht',
    ].join('\n');
    
    const response = await generateResponse(
      config, 'new', [],
      { name: prospect.name, headline: prospect.headline, company: prospect.company },
      undefined, aiPrompt,
    );
    
    let msg = (response.message || '').trim();
    if ((msg.startsWith('"') && msg.endsWith('"')) || (msg.startsWith("'") && msg.endsWith("'"))) {
      msg = msg.slice(1, -1);
    }
    msg = msg.substring(0, MAX_CHARS);
    
    await updateProspect(prospect_id, { invite_message: msg, status: 'enriched', enriched: true });
    
    return NextResponse.json({ success: true, message: msg }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[Regenerate]', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
