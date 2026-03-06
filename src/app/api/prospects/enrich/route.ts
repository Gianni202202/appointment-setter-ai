import { NextRequest, NextResponse } from 'next/server';
import { getProspects, updateProspect } from '@/lib/database';
import { getProfile, randomDelay } from '@/lib/unipile';
import { generateResponse } from '@/lib/claude';
import { getConfigAsync } from '@/lib/database';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export const maxDuration = 300; // 5 min — we process slowly on purpose

const MAX_PER_REQUEST = 25; // Max 25 prospects per batch (like Elvatix)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prospect_ids, instruction, maxCount = 25 } = body;
    
    if (!instruction) {
      return NextResponse.json({ error: 'Provide an instruction for the connection message' }, { status: 400, headers: corsHeaders });
    }
    
    // Get prospects to enrich
    let toProcess;
    if (prospect_ids && prospect_ids.length > 0) {
      const all = await getProspects();
      toProcess = all.filter(p => prospect_ids.includes(p.id) && p.status === 'imported');
    } else {
      toProcess = (await getProspects('imported'));
    }
    
    toProcess = toProcess.slice(0, Math.min(maxCount, MAX_PER_REQUEST));
    
    if (toProcess.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: 'No imported prospects to process' }, { headers: corsHeaders });
    }
    
    const config = await getConfigAsync();
    const results: { id: string; name: string; success: boolean; message?: string; error?: string }[] = [];
    
    for (let i = 0; i < toProcess.length; i++) {
      const prospect = toProcess[i];
      
      try {
        // ── Step 1: Get Profile (enrichment) ──
        const identifier = prospect.public_identifier || prospect.provider_id;
        const profile = await getProfile(identifier, ['experience', 'skills']);
        
        // Extract profile data
        const experience = ((profile as any).experience || []).slice(0, 5).map((exp: any) => ({
          company: exp.company_name || exp.company || '',
          role: exp.title || exp.role || '',
          duration: exp.duration || '',
        }));
        const skills = ((profile as any).skills || []).slice(0, 10).map((s: any) => s.name || s);
        const summary = (profile as any).summary || (profile as any).about || '';
        const currentCompany = experience[0]?.company || prospect.company;
        const currentRole = experience[0]?.role || prospect.headline;
        
        // ── Step 2: AI generates personalized connection request ──
        const prospectContext = [
          `Name: ${prospect.name}`,
          `Current Role: ${currentRole}`,
          `Company: ${currentCompany}`,
          `Headline: ${prospect.headline}`,
          summary ? `About: ${summary.substring(0, 200)}` : '',
          skills.length > 0 ? `Skills: ${skills.slice(0, 5).join(', ')}` : '',
          experience.length > 1 ? `Previous: ${experience[1]?.role} at ${experience[1]?.company}` : '',
        ].filter(Boolean).join('\n');
        
        const aiPrompt = `Je schrijft een LinkedIn connectieverzoek-bericht (MAX 300 tekens!).

INSTRUCTIE VAN GEBRUIKER:
${instruction}

PROFIEL VAN PROSPECT:
${prospectContext}

REGELS:
- MAX 300 tekens (LinkedIn limiet voor connectieverzoeken)
- Persoonlijk en relevant op basis van het profiel
- Kort, menselijk, geen spam-gevoel
- Geen links, geen emoji's, geen verkoop-taal
- Nederlands tenzij het profiel Engels is
- Schrijf ALLEEN het bericht zelf, geen uitleg`;

        const response = await generateResponse(
          config,
          'new',
          [],
          { name: prospect.name, headline: prospect.headline, company: currentCompany },
          undefined,
          aiPrompt,
        );
        
        const inviteMessage = (response.message || '').substring(0, 300);
        
        // ── Step 3: Update prospect with enrichment + generated message ──
        await updateProspect(prospect.id, {
          enriched: true,
          status: 'enriched',
          summary,
          experience,
          skills,
          company: currentCompany,
          headline: (profile as any).headline || prospect.headline,
          invite_message: inviteMessage,
        });
        
        results.push({ 
          id: prospect.id, 
          name: prospect.name, 
          success: true,
          message: inviteMessage,
        });
        
        console.log(`[Enrich] ✅ ${i + 1}/${toProcess.length} — ${prospect.name} processed`);
        
      } catch (error: any) {
        console.error(`[Enrich] ❌ ${prospect.name}: ${error.message}`);
        results.push({ id: prospect.id, name: prospect.name, success: false, error: error.message });
      }
      
      // ── Human-like delay between Get Profile calls ──
      // Random interval 8-20 seconds (niet regulier!)
      if (i < toProcess.length - 1) {
        const delay = 8000 + Math.floor(Math.random() * 12000); // 8-20s
        console.log(`[Enrich] ⏳ Waiting ${(delay/1000).toFixed(1)}s before next profile...`);
        await randomDelay(delay, delay + 1000);
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
    console.error('[Enrich Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
}
