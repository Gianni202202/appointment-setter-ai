import { NextResponse } from 'next/server';
import {
  getAgentMode, getAgentModeAsync, setAgentMode,
  getAgentChatHistory, addAgentChatMessage,
  getAgentScanSettings, updateAgentScanSettings,
  getDrafts, getDraft, updateDraft, removeDraft, addDraft, getSentTodayCount,
  getConfig, getConfigAsync, updateConfig,
  logActivity,
} from '@/lib/database';
import { getDailyCapacity } from '@/lib/human-timing';
import { generateDraftForChat } from '@/lib/draft-generator';

// Pro plan: allow up to 60s execution
export const maxDuration = 60;

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

const COMMAND_SYSTEM_PROMPT = `You are Jarvis — Gianni Linssen's personal AI appointment setter assistant.
You operate inside his LinkedIn DM dashboard called GhostDM. You have FULL ACCESS to every part of the system.
You are not a chatbot — you are an operator. You execute tasks, make changes, and manage the entire outreach pipeline.

=== WHO IS GIANNI ===
- Founder of Elvatix — a tool that helps recruitment teams send personalized outreach at scale
- Uses GhostDM to manage LinkedIn DM conversations with prospects (mostly recruiters)
- Speaks Dutch primarily, switches to English with international prospects
- Communication style: casual, direct, like WhatsApp — never salesy or corporate

=== HOW THE SYSTEM WORKS ===

DASHBOARD has 3 modes:
- **Off**: No AI activity
- **Copilot** (default): AI scans inbox, generates draft replies, Gianni reviews & approves before sending
- **Auto**: AI sends automatically (rarely used)

DRAFT LIFECYCLE:
1. Copilot scans LinkedIn inbox via Unipile API → identifies interesting conversations
2. AI generates a draft reply for each conversation based on context + active strategies
3. Drafts appear as "pending" on dashboard → Gianni reviews each one
4. He can: Approve ✅ | Regenerate 🔄 | Edit ✏️ | Remove ❌
5. Approved drafts go to send queue → sent with human-like timing (random delays)

CONVERSATION PHASES: new → engaged → objection → qualified → booked → dead
- Each phase determines AI writing style and goal
- "new" = first contact, keep it light
- "engaged" = in conversation, build rapport
- "objection" / "weerstand" = they pushed back, handle gracefully
- "qualified" = warm enough for Loom video or call
- "booked" = meeting scheduled

STRATEGIES:
- Templates that define the ANGLE for outreach (stored in config.strategies)
- Each strategy has: name, scenario (when to use it), template text, instruction for AI
- When generating drafts, the AI uses active strategies as inspiration
- The AI adapts the template to each prospect's context — never copy-paste

SETTINGS (config):
- tone: writing style, max message length, language
- rules: goal, offer description, follow-up delays, working hours
- best_practices: free-text rules Gianni writes (e.g., "nooit 'Ben benieuwd' gebruiken")
- strategies: array of strategy templates
- blacklist: names/companies to skip

=== YOUR TOOLS ===

Embed as JSON array after "---ACTIONS---" in your response:

DRAFT MANAGEMENT:
- {"type":"GENERATE_DRAFTS","params":{"instruction":"angle description","force_regenerate":true}}
  → Replaces ALL pending drafts with new ones using the given instruction/angle
  → force_regenerate=true = delete old drafts, create new ones
  → The instruction tells the AI HOW to write (e.g., "use the Elvatix mini-tool pitch")
  
- {"type":"GENERATE_DRAFTS","params":{"chat_ids":["id1","id2"],"instruction":"angle"}}
  → Generate drafts only for specific conversations (use chat_ids from context)

- {"type":"APPROVE_DRAFT","params":{"draft_id":"id"}} → Approve a draft for sending
- {"type":"REJECT_DRAFT","params":{"draft_id":"id","reason":"why"}} → Reject with feedback
- {"type":"EDIT_DRAFT","params":{"draft_id":"id","message":"new text"}} → Rewrite a draft's text directly

MODE & STATUS:
- {"type":"CHANGE_MODE","params":{"mode":"copilot|auto|off"}} → Switch operating mode
- {"type":"SHOW_STATS"} → Show current numbers (pending, approved, sent today)
- {"type":"SCAN_INBOX","params":{"maxAgeDays":7}} → Scan inbox for conversations needing attention

SETTINGS:
- {"type":"UPDATE_CONFIG","params":{"strategies":[{"name":"Name","scenario":"connection_follow_up","template":"Ha {{Naam}},...","instruction":"Use this angle","active":true}]}}
  → Save strategy templates. These persist and are used in all future draft generation.
  
- {"type":"UPDATE_CONFIG","params":{"best_practices":"rules here"}} → Update writing rules
- {"type":"UPDATE_CONFIG","params":{"tone":{"max_message_length":300}}} → Change tone settings
- {"type":"UPDATE_SCAN_SETTINGS","params":{"maxAgeDays":14}} → Change scan filter

=== CRITICAL OPERATING RULES ===

1. ALWAYS ACT — When Gianni asks you to DO something, you MUST include ---ACTIONS--- with the right tools. Talking about it is NOT enough. You are an operator, not an advisor.

2. STRATEGY = TEMPLATE — When Gianni gives you a message template, SAVE IT as a strategy using UPDATE_CONFIG. Then USE IT to regenerate drafts with GENERATE_DRAFTS + force_regenerate:true.

3. REPLACE, DON'T ADD — When regenerating drafts, always use force_regenerate:true to replace old ones. Never create duplicates.

4. NAME → CHAT_ID — When Gianni mentions someone by name (e.g., "pas de draft voor Luc aan"), find their chat_id in the ACTIVE CONVERSATIONS context and use it.

5. CONFIRM WITH SPECIFICS — After acting, tell Gianni exactly what you did: "Ik heb de draft voor Luc aangepast naar: [tekst]" — not "Ik ga het aanpassen".

6. COMBINED ACTIONS — You can do multiple things at once. Example: save a strategy AND regenerate all drafts in one response by including multiple actions in the JSON array.

7. MATCH LANGUAGE — Respond in the same language Gianni uses (usually Dutch).

=== RESPONSE FORMAT ===

Natural response first, then actions:

"Top! Ik heb je template opgeslagen als 'Mini Elvatix Pitch' strategie en alle 12 drafts worden nu opnieuw gegenereerd met deze invalshoek.
---ACTIONS---
[{"type":"UPDATE_CONFIG","params":{"strategies":[{"name":"Mini Elvatix Pitch","scenario":"connection_follow_up","template":"Ha {{Naam}}, De standaard leuk dat we gelinkt zijn sla ik over...","instruction":"Gebruik de Mini Elvatix Pitch invalshoek. Pas aan op prospect context.","active":true}]}},{"type":"GENERATE_DRAFTS","params":{"instruction":"Gebruik de Mini Elvatix Pitch: directe, geen-bullshit benadering met link naar gratis mini-tool","force_regenerate":true}}]"

=== CONTEXT YOU RECEIVE ===
You get real-time data with every message:
- ACTIVE CONVERSATIONS: names + chat_ids + last messages
- PENDING DRAFTS: draft_ids + prospect names + current text
- APPROVED DRAFTS: ready to send
- CURRENT SETTINGS: strategies, best practices, tone, goal
- STATS: mode, counts, daily send capacity
`;

export async function POST(request: Request) {
  try {
    const { message } = await request.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    addAgentChatMessage({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    });

    const mode = await getAgentModeAsync();
    const drafts = await getDrafts();
    const pendingDrafts = drafts.filter(d => d.status === 'pending');
    const approvedDrafts = drafts.filter(d => d.status === 'approved');
    const sentToday = await getSentTodayCount();
    const dailyCap = getDailyCapacity(0);
    const scanSettings = getAgentScanSettings();
    const chatHistory = getAgentChatHistory().slice(-10);
    const config = await getConfigAsync();

    // Build conversation context
    let conversationContext = '';
    try {
      if (DSN && API_KEY && ACCOUNT_ID && DSN !== 'undefined') {
        const chatsRes = await fetch(`https://${DSN}/api/v1/chats?account_id=${ACCOUNT_ID}&limit=25`, {
          headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
          cache: 'no-store',
        });
        if (chatsRes.ok) {
          const chatsData = await chatsRes.json();
          const chats = chatsData.items || chatsData || [];
          const chatSummaries: string[] = [];
          for (const chat of chats.slice(0, 20)) {
            const name = chat.name || chat.title || 'Unknown';
            const lastMsg = chat.last_message;
            const lastText = lastMsg?.text ? lastMsg.text.substring(0, 80) : 'no preview';
            const isMine = lastMsg ? (lastMsg.is_sender || lastMsg.sender?.is_me) : false;
            const who = isMine ? 'jij' : name;
            chatSummaries.push(`  - ${name} (chat_id: ${chat.id}) — laatste bericht van ${who}: "${lastText}"`);
          }
          conversationContext = '\nACTIVE CONVERSATIONS (recent):\n' + chatSummaries.join('\n');
        }
      }
    } catch (e) { console.warn('[Agent Chat] Failed to build conversation context', e); }

    // Build pending draft context with full IDs
    let draftContext = '';
    if (pendingDrafts.length > 0) {
      draftContext = '\nPENDING DRAFTS (need review):\n' + pendingDrafts.slice(0, 15).map(d =>
        `  - ${d.prospect_name} (draft_id: ${d.id}, chat_id: ${d.chat_id}): "${d.message.substring(0, 80)}..."`
      ).join('\n');
    }
    if (approvedDrafts.length > 0) {
      draftContext += '\nAPPROVED DRAFTS (ready to send):\n' + approvedDrafts.slice(0, 10).map(d =>
        `  - ${d.prospect_name} (draft_id: ${d.id}): "${d.message.substring(0, 60)}..."`
      ).join('\n');
    }

    // Build config context (with safe access)
    let configContext = '';
    try {
      const tone = config.tone || {} as any;
      const rules = config.rules || {} as any;
      configContext = `\nCURRENT SETTINGS:
- Best practices: ${config.best_practices ? config.best_practices.substring(0, 200) : '(leeg)'}
- Strategies: ${(config.strategies || []).length} templates (${(config.strategies || []).filter((s: any) => s.active).length} actief)
${(config.strategies || []).map((s: any) => `  - "${s.name}" (${s.scenario}, ${s.active ? 'actief' : 'inactief'})`).join('\n')}
- Tone: ${tone.style || 'not set'}, max ${tone.max_message_length || 300} chars, taal: ${tone.language || 'nl'}
- Goal: ${rules.goal?.substring(0, 100) || 'niet ingesteld'}`;
    } catch (e) { console.warn('[Agent Chat] Config context error:', e); }

    const contextBlock = `CURRENT STATE:
- Mode: ${mode}
- Pending drafts: ${pendingDrafts.length}
- Approved drafts: ${approvedDrafts.length}
- Sent today: ${sentToday}/${dailyCap}
- LinkedIn connected: ${!!(DSN && API_KEY && ACCOUNT_ID)}${conversationContext}${draftContext}${configContext}`;

    const geminiContents: { role: string; content: string }[] = [];
    for (const msg of chatHistory.slice(0, -1)) {
      geminiContents.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }
    geminiContents.push({
      role: 'user',
      content: `${contextBlock}\n\nUSER MESSAGE: ${message}`,
    });

    if (!GEMINI_KEY) {
      const fallbackResponse = {
        message: `Ik begrijp je verzoek, maar de GEMINI_API_KEY is niet geconfigureerd. Status: mode=${mode}, ${pendingDrafts.length} pending drafts.`,
        actions: [] as any[],
      };
      addAgentChatMessage({ role: 'agent', content: fallbackResponse.message, timestamp: new Date().toISOString(), actions: [] });
      return NextResponse.json(fallbackResponse);
    }

    // Call Gemini
    const geminiMessages = geminiContents.map((m) => ({
      role: m.role === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content }],
    }));

    const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: COMMAND_SYSTEM_PROMPT }] },
        contents: geminiMessages,
        generationConfig: { maxOutputTokens: 8000, temperature: 0.7 },
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('[Agent Chat] Gemini API error:', apiRes.status, errText);
      const errorMsg = `Er ging iets mis met de AI (status ${apiRes.status}). Probeer het opnieuw.`;
      addAgentChatMessage({ role: 'agent', content: errorMsg, timestamp: new Date().toISOString() });
      return NextResponse.json({ message: errorMsg, actions: [], mode });
    }

    const apiData = await apiRes.json();
    let responseText = '';
    if (apiData.candidates && apiData.candidates[0]?.content?.parts) {
      for (const part of apiData.candidates[0].content.parts) {
        if (part.text) responseText += part.text;
      }
    }
    if (!responseText) {
      console.warn('[Agent Chat] Empty response from Gemini:', JSON.stringify(apiData).substring(0, 500));
      responseText = 'Ik heb je verzoek ontvangen, maar kon geen antwoord genereren. Kun je het anders formuleren?';
    }

    // Parse response + actions
    let messageText = responseText;
    let parsedActions: { type: string; params?: any }[] = [];

    const actionsSplit = responseText.split('---ACTIONS---');
    if (actionsSplit.length > 1) {
      messageText = actionsSplit[0].trim();
      try {
        let actionsJson = actionsSplit[1].trim();
        // Clean markdown code fences if present
        actionsJson = actionsJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        parsedActions = JSON.parse(actionsJson);
      } catch (e) {
        console.warn('[Agent Chat] Failed to parse actions:', e);
      }
    }

    const parsed = { message: messageText, actions: parsedActions };
    const actionResults: { type: string; result: string }[] = [];

    // === EXECUTE ALL ACTIONS ===
    for (const action of parsed.actions || []) {
      try {
        switch (action.type) {
          case 'CHANGE_MODE': {
            const newMode = action.params?.mode;
            if (['off', 'copilot', 'auto'].includes(newMode)) {
              setAgentMode(newMode);
              actionResults.push({ type: 'CHANGE_MODE', result: `Mode changed to ${newMode}` });
            }
            break;
          }

          case 'SHOW_STATS': {
            actionResults.push({
              type: 'SHOW_STATS',
              result: `Mode: ${mode}, Pending: ${pendingDrafts.length}, Approved: ${approvedDrafts.length}, Sent: ${sentToday}/${dailyCap}`,
            });
            break;
          }

          case 'UPDATE_CONFIG': {
            // Full config update — can update best_practices, strategies, tone, rules, etc.
            const params = action.params || {};
            const currentConfig = await getConfigAsync();
            const merged: any = { ...currentConfig };

            if (params.best_practices !== undefined) merged.best_practices = params.best_practices;
            if (params.strategies !== undefined) {
              // Validate and normalize strategy format
              merged.strategies = (Array.isArray(params.strategies) ? params.strategies : []).map((s: any) => ({
                id: s.id || 'strat_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
                name: s.name || 'Unnamed Strategy',
                scenario: s.scenario || 'general',
                template: s.template || '',
                instruction: s.instruction || '',
                active: s.active !== false,
              }));
            }
            if (params.blacklist !== undefined) merged.blacklist = params.blacklist;
            if (params.tone) merged.tone = { ...currentConfig.tone, ...params.tone };
            if (params.rules) merged.rules = { ...currentConfig.rules, ...params.rules };

            await updateConfig(merged);
            const changes = Object.keys(params).join(', ');
            actionResults.push({ type: 'UPDATE_CONFIG', result: `Config updated: ${changes}` });
            break;
          }

          case 'UPDATE_SCAN_SETTINGS': {
            const updates: any = {};
            if (action.params?.maxAgeDays !== undefined) updates.maxAgeDays = action.params.maxAgeDays;
            if (action.params?.phases !== undefined) updates.phases = action.params.phases;
            if (action.params?.limit !== undefined) updates.limit = action.params.limit;
            if (action.params?.autoSend !== undefined) updates.autoSend = action.params.autoSend;
            updateAgentScanSettings(updates);
            actionResults.push({ type: 'UPDATE_SCAN_SETTINGS', result: JSON.stringify(updates) });
            break;
          }

          case 'APPROVE_DRAFT': {
            const draftId = action.params?.draft_id;
            if (draftId) {
              const draft = await getDraft(draftId);
              if (draft) {
                await updateDraft(draftId, {
                  status: 'approved',
                  approved_at: new Date().toISOString(),
                  message: action.params?.message || draft.message,
                });
                await logActivity('draft_approved', draft.prospect_name || 'Unknown', { draft_id: draftId });
                actionResults.push({ type: 'APPROVE_DRAFT', result: `Draft approved for ${draft.prospect_name}` });
              } else {
                actionResults.push({ type: 'APPROVE_DRAFT', result: 'Draft not found: ' + draftId });
              }
            }
            break;
          }

          case 'REJECT_DRAFT': {
            const draftId = action.params?.draft_id;
            if (draftId) {
              const draft = await getDraft(draftId);
              if (draft) {
                await updateDraft(draftId, { status: 'rejected' });
                await logActivity('draft_rejected', draft.prospect_name || 'Unknown', { draft_id: draftId, reason: action.params?.reason });
                actionResults.push({ type: 'REJECT_DRAFT', result: `Draft rejected for ${draft.prospect_name}` });
              } else {
                actionResults.push({ type: 'REJECT_DRAFT', result: 'Draft not found' });
              }
            }
            break;
          }

          case 'EDIT_DRAFT': {
            const draftId = action.params?.draft_id;
            const newMessage = action.params?.message;
            if (draftId && newMessage) {
              const draft = await getDraft(draftId);
              if (draft) {
                await updateDraft(draftId, { message: newMessage });
                actionResults.push({ type: 'EDIT_DRAFT', result: `Draft edited for ${draft.prospect_name}` });
              } else {
                actionResults.push({ type: 'EDIT_DRAFT', result: 'Draft not found' });
              }
            }
            break;
          }

          case 'SCAN_INBOX': {
            if (!DSN || !API_KEY || !ACCOUNT_ID) {
              actionResults.push({ type: 'SCAN_INBOX', result: 'LinkedIn not connected' });
              break;
            }
            const maxAge = action.params?.maxAgeDays || scanSettings.maxAgeDays;
            const chatsRes = await fetch(`https://${DSN}/api/v1/chats?account_id=${ACCOUNT_ID}&limit=50`, {
              headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
              cache: 'no-store',
            });
            if (chatsRes.ok) {
              const chatsData = await chatsRes.json();
              const chats = chatsData.items || chatsData || [];
              const existingDraftChatIds = new Set(
                (await getDrafts()).filter(d => d.status === 'pending' || d.status === 'approved').map(d => d.chat_id)
              );
              let totalActive = 0, alreadyDrafted = 0, prospectLast = 0, youLast = 0;
              for (const chat of chats) {
                if (chat.account_id && chat.account_id !== ACCOUNT_ID) continue;
                if (existingDraftChatIds.has(chat.id)) { alreadyDrafted++; continue; }
                const lastMsg = chat.last_message;
                const isSentByMe = lastMsg ? (lastMsg.is_sender || lastMsg.sender?.is_me) : false;
                if (isSentByMe) youLast++;
                else prospectLast++;
                totalActive++;
              }
              actionResults.push({
                type: 'SCAN_INBOX',
                result: `Scanned ${chats.length} chats: ${prospectLast} awaiting your reply, ${youLast} awaiting prospect, ${alreadyDrafted} already have drafts`,
              });
            } else {
              actionResults.push({ type: 'SCAN_INBOX', result: 'Failed to fetch chats' });
            }
            break;
          }

          case 'GENERATE_DRAFTS': {
            if (!DSN || !API_KEY || !ACCOUNT_ID) {
              actionResults.push({ type: 'GENERATE_DRAFTS', result: 'LinkedIn not connected' });
              break;
            }
            const instruction = action.params?.instruction || '';
            const forceRegenerate = action.params?.force_regenerate === true;
            let chatIdsToProcess: string[] = action.params?.chat_ids || [];

            // Build map of old drafts per chat_id for replacement
            const oldDraftsByChatId = new Map<string, string[]>();
            for (const d of pendingDrafts) {
              const existing = oldDraftsByChatId.get(d.chat_id) || [];
              existing.push(d.id);
              oldDraftsByChatId.set(d.chat_id, existing);
            }

            // If force_regenerate with no specific chat_ids → regenerate ALL pending drafts
            if (forceRegenerate && chatIdsToProcess.length === 0 && pendingDrafts.length > 0) {
              chatIdsToProcess = pendingDrafts.map(d => d.chat_id);
              // Deduplicate chat_ids (in case multiple drafts per chat)
              chatIdsToProcess = [...new Set(chatIdsToProcess)];
              actionResults.push({ type: 'GENERATE_DRAFTS', result: `Regenerating ${chatIdsToProcess.length} drafts with new instruction...` });
            }

            // If no specific chat_ids and not force_regenerate, find chats needing attention
            if (chatIdsToProcess.length === 0) {
              const chatsRes = await fetch(`https://${DSN}/api/v1/chats?account_id=${ACCOUNT_ID}&limit=50`, {
                headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
                cache: 'no-store',
              });
              if (!chatsRes.ok) {
                actionResults.push({ type: 'GENERATE_DRAFTS', result: 'Failed to fetch chats' });
                break;
              }
              const chatsData = await chatsRes.json();
              const chats = chatsData.items || chatsData || [];
              const existingDraftChatIds = new Set(
                (await getDrafts()).filter(d => d.status === 'pending' || d.status === 'approved').map(d => d.chat_id)
              );
              for (const c of chats) {
                if (c.account_id && c.account_id !== ACCOUNT_ID) continue;
                if (!forceRegenerate && existingDraftChatIds.has(c.id)) continue;
                const lastMsg = c.last_message;
                if (lastMsg) chatIdsToProcess.push(c.id);
              }
            }

            if (chatIdsToProcess.length === 0) {
              actionResults.push({ type: 'GENERATE_DRAFTS', result: 'No chats found to generate drafts for' });
              break;
            }

            // Process each chat: remove old draft → generate new one (no duplicates)
            let draftsCreated = 0;
            let draftsFailed = 0;
            let draftsRemoved = 0;
            const draftErrors: string[] = [];

            for (const chatId of chatIdsToProcess.slice(0, 10)) {
              try {
                // Step 1: Remove old drafts for this chat_id
                const oldIds = oldDraftsByChatId.get(chatId) || [];
                for (const oldId of oldIds) {
                  await removeDraft(oldId);
                  draftsRemoved++;
                }

                // Step 2: Generate new draft with instruction
                const result = await generateDraftForChat(chatId, instruction || undefined);
                if (result) {
                  draftsCreated++;
                } else {
                  draftsFailed++;
                  draftErrors.push(chatId.substring(0, 8) + ': AI returned no result');
                }
              } catch (err: any) {
                draftsFailed++;
                draftErrors.push(chatId.substring(0, 8) + ': ' + (err?.message || String(err)).substring(0, 50));
              }
            }

            const errorDetail = draftErrors.length > 0 ? ' | Errors: ' + draftErrors.join('; ') : '';
            actionResults.push({
              type: 'GENERATE_DRAFTS',
              result: `${draftsCreated} new drafts created, ${draftsRemoved} old removed${draftsFailed > 0 ? ', ' + draftsFailed + ' failed' : ''} (of ${chatIdsToProcess.length} chats)${instruction ? ' — angle: ' + instruction.substring(0, 50) + '...' : ''}${errorDetail}`,
            });
            break;
          }

          default:
            actionResults.push({ type: action.type, result: 'Unknown action type' });
        }
      } catch (err) {
        actionResults.push({ type: action.type, result: 'Error: ' + String(err) });
      }
    }

    addAgentChatMessage({
      role: 'agent',
      content: parsed.message,
      timestamp: new Date().toISOString(),
      actions: actionResults,
    });

    return NextResponse.json({
      message: parsed.message,
      actions: actionResults,
      mode: getAgentMode(),
    });
  } catch (error: any) {
    console.error('[Agent Chat] Error:', error?.message || error, error?.stack || '');
    const errorMsg = 'Er ging iets mis met de AI. Probeer het opnieuw.';
    addAgentChatMessage({ role: 'agent', content: errorMsg + ' (Error: ' + String(error?.message || error) + ')', timestamp: new Date().toISOString() });
    return NextResponse.json({ message: errorMsg, actions: [], error: String(error?.message || error) }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({
    history: getAgentChatHistory(),
    mode: getAgentMode(),
    scan_settings: getAgentScanSettings(),
  });
}
