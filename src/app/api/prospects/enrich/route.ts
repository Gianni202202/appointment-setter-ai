import { NextRequest, NextResponse } from 'next/server';
import { getProspects, updateProspect } from '@/lib/database';
import { getProfile } from '@/lib/unipile';
import { generateResponse } from '@/lib/claude';
import { getConfigAsync } from '@/lib/database';

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

const MAX_PER_REQUEST = 25;
const MAX_MESSAGE_CHARS = 290;

const DEFAULT_INSTRUCTION = 'Schrijf een persoonlijk en relevant connectieverzoek. Refereer aan de rol, het bedrijf of de expertise van de prospect. Toon oprechte interesse.';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prospect_ids, instruction, maxCount = 25 } = body;
    
    // Instruction is OPTIONAL — use strong default if not provided
    const finalInstruction = (instruction && instruction.trim()) || DEFAULT_INSTRUCTION;
    
    console.log('[Enrich] Starting with instruction:', finalInstruction.substring(0, 60) + '...');
    
    // Get prospects to enrich
    let toProcess;
    if (prospect_ids && prospect_ids.length > 0) {
      const all = await getProspects();
      toProcess = all.filter((p: any) => prospect_ids.includes(p.id) && p.status === 'imported');
    } else {
      toProcess = (await getProspects('imported'));
    }
    
    toProcess = toProcess.slice(0, Math.min(maxCount, MAX_PER_REQUEST));
    
    if (toProcess.length === 0) {
      return NextResponse.json({ 
        success: true, processed: 0, 
        message: 'No imported prospects to process' 
      }, { headers: corsHeaders });
    }
    
    console.log('[Enrich] Processing', toProcess.length, 'prospects...');
    
    const config = await getConfigAsync();
    const results: { id: string; name: string; success: boolean; message?: string; error?: string }[] = [];
    
    for (let i = 0; i < toProcess.length; i++) {
      const prospect = toProcess[i];
      
      try {
        // Step 1: Get Profile (enrichment)
        const identifier = prospect.public_identifier || prospect.provider_id;
        console.log('[Enrich]', (i + 1) + '/' + toProcess.length, 'Fetching profile:', identifier);
        
        let profile: any = {};
        try {
          profile = await getProfile(identifier, ['experience', 'skills']);
        } catch (profileErr: any) {
          console.error('[Enrich] Profile fetch failed for', prospect.name, ':', profileErr.message);
          // Still generate message based on available data from search
        }
        
        const experience = (profile.experience || []).slice(0, 5).map((exp: any) => ({
          company: exp.company_name || exp.company || '',
          role: exp.title || exp.role || '',
          duration: exp.duration || '',
        }));
        const skills = (profile.skills || []).slice(0, 10).map((s: any) => s.name || s);
        const summary = profile.summary || profile.about || '';
        const currentCompany = experience[0]?.company || prospect.company;
        const currentRole = experience[0]?.role || prospect.headline;
        
        // Step 2: AI generates personalized connection request
        const prospectContext = [
          'Naam: ' + prospect.name,
          'Huidige Functie: ' + currentRole,
          'Bedrijf: ' + currentCompany,
          'Headline: ' + prospect.headline,
          summary ? 'Over: ' + summary.substring(0, 200) : '',
          skills.length > 0 ? 'Skills: ' + skills.slice(0, 5).join(', ') : '',
          experience.length > 1 ? ('Vorige functie: ' + experience[1]?.role + ' bij ' + experience[1]?.company) : '',
        ].filter(Boolean).join('\n');
        
        const aiPrompt = [
          'Je bent een expert in het schrijven van authentieke LinkedIn connectieverzoeken.',
          '',
          'INSTRUCTIE VAN DE AFZENDER:',
          finalInstruction,
          '',
          'PROFIEL VAN DE ONTVANGER:',
          prospectContext,
          '',
          'STRENGE REGELS:',
          '- MAXIMAAL ' + MAX_MESSAGE_CHARS + ' TEKENS (harde LinkedIn limiet)',
          '- Spreek de persoon aan met voornaam',
          '- Maak het persoonlijk: refereer specifiek aan hun functie, bedrijf of expertise',
          '- Wees oprecht en menselijk',
          '- Geen emoji\'s, links, of verkooppraatjes',
          '- Nederlands, tenzij het profiel duidelijk Engels is',
          '- Schrijf ALLEEN het bericht zelf, geen uitleg, geen aanhalingstekens',
        ].join('\n');
        
        const response = await generateResponse(
          config,
          'new',
          [],
          { name: prospect.name, headline: prospect.headline, company: currentCompany },
          undefined,
          aiPrompt,
        );
        
        // Enforce hard character limit + strip quotes
        let inviteMessage = (response.message || '').trim();
        if ((inviteMessage.startsWith('"') && inviteMessage.endsWith('"')) ||
            (inviteMessage.startsWith("'") && inviteMessage.endsWith("'"))) {
          inviteMessage = inviteMessage.slice(1, -1);
        }
        inviteMessage = inviteMessage.substring(0, MAX_MESSAGE_CHARS);
        
        // Step 3: Update prospect
        await updateProspect(prospect.id, {
          enriched: true,
          status: 'enriched',
          summary,
          experience,
          skills,
          company: currentCompany,
          headline: profile.headline || prospect.headline,
          invite_message: inviteMessage,
        });
        
        results.push({ 
          id: prospect.id, 
          name: prospect.name, 
          success: true,
          message: inviteMessage,
        });
        
        console.log('[Enrich] ✅', (i + 1) + '/' + toProcess.length, prospect.name, '(' + inviteMessage.length + ' chars)');
        
      } catch (error: any) {
        console.error('[Enrich] ❌', prospect.name, ':', error.message);
        results.push({ id: prospect.id, name: prospect.name, success: false, error: error.message });
      }
      
      // Human-like delay between Get Profile calls (8-20s, random)
      if (i < toProcess.length - 1) {
        const delay = 8000 + Math.floor(Math.random() * 12000);
        console.log('[Enrich] ⏳ Waiting', (delay/1000).toFixed(1) + 's before next...');
        await new Promise(r => setTimeout(r, delay));
      }
    }
    
    const processed = results.filter(r => r.success).length;
    return NextResponse.json({ 
      success: true, 
      processed,
      failed: results.length - processed,
      total: toProcess.length,
      results,
    }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[Enrich Error]', error.message, error.stack);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
