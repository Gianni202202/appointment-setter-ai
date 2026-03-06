import { NextRequest, NextResponse } from 'next/server';
import { getProspects, updateProspect, getConfigAsync } from '@/lib/database';
import { getProfile, getUserPosts } from '@/lib/unipile';
import { generateResponse } from '@/lib/claude';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — we process slowly on purpose

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

const MAX_PER_BATCH = 25;
const MAX_MESSAGE_CHARS = 290; // LinkedIn connection request limit (safe buffer under 300)
const PROFILE_DELAY_MIN = 12000; // 12 seconds between profile calls
const PROFILE_DELAY_MAX = 15000; // 15 seconds max

const DEFAULT_INSTRUCTION = 'Schrijf een persoonlijk en relevant connectieverzoek. Refereer aan de rol, het bedrijf of de expertise van de prospect. Toon oprechte interesse.';

function humanDelay(): Promise<void> {
  const ms = PROFILE_DELAY_MIN + Math.floor(Math.random() * (PROFILE_DELAY_MAX - PROFILE_DELAY_MIN));
  console.log('[Enrich] ⏳ Waiting ' + (ms / 1000).toFixed(1) + 's...');
  return new Promise(r => setTimeout(r, ms));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prospect_ids, instruction, maxCount = 25 } = body;
    
    // Instruction is OPTIONAL — use strong default if not provided
    const finalInstruction = (instruction && instruction.trim()) || DEFAULT_INSTRUCTION;
    
    console.log('[Enrich] Starting — instruction:', finalInstruction.substring(0, 60) + '...');
    
    // Get prospects to enrich
    let toProcess: any[];
    if (prospect_ids && prospect_ids.length > 0) {
      const all = await getProspects();
      toProcess = all.filter((p: any) => prospect_ids.includes(p.id) && p.status === 'imported');
    } else {
      toProcess = await getProspects('imported');
    }
    
    toProcess = toProcess.slice(0, Math.min(maxCount, MAX_PER_BATCH));
    
    if (toProcess.length === 0) {
      return NextResponse.json({ 
        success: true, processed: 0, total: 0,
        message: 'No imported prospects to process' 
      }, { headers: corsHeaders });
    }
    
    console.log('[Enrich] Processing', toProcess.length, 'prospects...');
    
    let config: any;
    try {
      config = await getConfigAsync();
    } catch (e: any) {
      console.error('[Enrich] Config error:', e.message);
      return NextResponse.json({ error: 'Failed to load AI config: ' + e.message }, { status: 500, headers: corsHeaders });
    }
    
    const results: { id: string; name: string; success: boolean; message?: string; error?: string }[] = [];
    
    for (let i = 0; i < toProcess.length; i++) {
      const prospect = toProcess[i];
      
      try {
        const identifier = prospect.public_identifier || prospect.provider_id;
        console.log('[Enrich]', (i + 1) + '/' + toProcess.length, 'Processing:', prospect.name, '(' + identifier + ')');
        
        // ── Step 1: Get Profile ──
        let profile: any = {};
        try {
          profile = await getProfile(identifier, ['experience', 'skills', 'education']);
        } catch (profileErr: any) {
          console.warn('[Enrich] Profile fetch failed for', prospect.name, '—', profileErr.message);
          // Continue with search data — non-blocking
        }
        
        // ── Step 2: Get recent posts (last 3, max 3 months old) ──
        let recentPosts: any[] = [];
        try {
          recentPosts = await getUserPosts(identifier, 3);
        } catch {
          // Non-critical — ignore
        }
        
        // ── Extract enrichment data ──
        const experience = (profile.experience || []).slice(0, 5).map((exp: any) => ({
          company: exp.company_name || exp.company || '',
          role: exp.title || exp.role || '',
          duration: exp.duration || '',
        }));
        const skills = (profile.skills || []).slice(0, 10).map((s: any) => s.name || s);
        const summary = profile.summary || profile.about || '';
        const currentCompany = experience[0]?.company || prospect.company;
        const currentRole = experience[0]?.role || prospect.headline;
        
        // ── Step 3: Build context for AI ──
        const contextParts = [
          'Naam: ' + prospect.name,
          'Huidige Functie: ' + currentRole,
          'Bedrijf: ' + currentCompany,
          prospect.headline ? 'Headline: ' + prospect.headline : '',
          summary ? 'Over: ' + summary.substring(0, 200) : '',
          skills.length > 0 ? 'Top skills: ' + skills.slice(0, 5).join(', ') : '',
          experience.length > 1 ? 'Vorige rol: ' + experience[1]?.role + ' bij ' + experience[1]?.company : '',
        ].filter(Boolean);
        
        // Add recent posts context
        if (recentPosts.length > 0) {
          contextParts.push('');
          contextParts.push('RECENTE LINKEDIN POSTS:');
          recentPosts.forEach((post, idx) => {
            const postSnippet = post.text.substring(0, 150).replace(/\n/g, ' ');
            contextParts.push((idx + 1) + '. "' + postSnippet + (post.text.length > 150 ? '...' : '') + '"');
          });
        }
        
        const prospectContext = contextParts.join('\n');
        
        // ── Step 4: Generate personalized message ──
        const aiPrompt = [
          'Je bent een expert in het schrijven van authentieke LinkedIn connectieverzoeken die ECHT persoonlijk zijn.',
          '',
          'INSTRUCTIE VAN DE AFZENDER:',
          finalInstruction,
          '',
          'PROFIEL VAN DE ONTVANGER:',
          prospectContext,
          '',
          'STRENGE REGELS — OVERTREED DEZE NIET:',
          '1. MAXIMAAL ' + MAX_MESSAGE_CHARS + ' TEKENS (harde LinkedIn limiet — elk teken erboven wordt afgesneden)',
          '2. Spreek de persoon aan met VOORNAAM',
          '3. Maak het SPECIFIEK: refereer aan concrete details uit hun profiel, rol, bedrijf of posts',
          '4. Wees oprecht en menselijk — schrijf alsof je een echt persoon bent',
          '5. GEEN emoji\'s, links, hashtags, of verkooppraatjes',
          '6. GEEN vage zinnen als "ik zag je profiel" of "indrukwekkend profiel"',
          '7. Nederlands, tenzij het profiel duidelijk Engels is',
          '8. Schrijf ALLEEN het bericht zelf. Geen uitleg, geen aanhalingstekens, geen intro.',
          recentPosts.length > 0 ? '9. BONUS: Refereer subtiel aan een van hun recente posts als dat relevant is' : '',
        ].filter(Boolean).join('\n');
        
        const response = await generateResponse(
          config,
          'new',
          [],
          { name: prospect.name, headline: prospect.headline, company: currentCompany },
          undefined,
          aiPrompt,
        );
        
        // Enforce hard character limit + clean up AI quirks
        let inviteMessage = (response.message || '').trim();
        
        // Strip surrounding quotes
        if ((inviteMessage.startsWith('"') && inviteMessage.endsWith('"')) ||
            (inviteMessage.startsWith("'") && inviteMessage.endsWith("'"))) {
          inviteMessage = inviteMessage.slice(1, -1).trim();
        }
        
        // Remove "Hier is het bericht:" type prefixes
        const prefixes = ['hier is', 'hier het', 'het bericht:', 'bericht:', 'message:'];
        for (const prefix of prefixes) {
          if (inviteMessage.toLowerCase().startsWith(prefix)) {
            inviteMessage = inviteMessage.substring(prefix.length).trim();
          }
        }
        
        // Hard truncate
        inviteMessage = inviteMessage.substring(0, MAX_MESSAGE_CHARS);
        
        // ── Step 5: Save enriched data ──
        const updateData: any = {
          enriched: true,
          status: 'enriched' as const,
          invite_message: inviteMessage,
          company: currentCompany,
          headline: profile.headline || prospect.headline,
        };
        if (summary) updateData.summary = summary;
        if (experience.length > 0) updateData.experience = experience;
        if (skills.length > 0) updateData.skills = skills;
        if (recentPosts.length > 0) updateData.recent_posts = recentPosts;
        
        await updateProspect(prospect.id, updateData);
        
        results.push({ 
          id: prospect.id, 
          name: prospect.name, 
          success: true,
          message: inviteMessage,
        });
        
        console.log('[Enrich] ✅', (i + 1) + '/' + toProcess.length, prospect.name, '(' + inviteMessage.length + '/' + MAX_MESSAGE_CHARS + ' chars)');
        
      } catch (error: any) {
        console.error('[Enrich] ❌', prospect.name, ':', error.message, error.stack?.substring(0, 200));
        results.push({ id: prospect.id, name: prospect.name, success: false, error: error.message });
      }
      
      // ── Human-like delay between profile calls (12-15s) ──
      if (i < toProcess.length - 1) {
        await humanDelay();
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
