import { NextResponse } from 'next/server';
import {
  getAgentMode, setAgentMode,
  getAgentChatHistory, addAgentChatMessage,
  getAgentScanSettings, updateAgentScanSettings,
  getDrafts, getSentTodayCount,
} from '@/lib/database';
import { getDailyCapacity } from '@/lib/human-timing';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

const COMMAND_SYSTEM_PROMPT = `You are the AI assistant for AppointmentAI — a LinkedIn DM appointment setter dashboard.
The user is your operator. They talk to you to control the agent, change settings, and give instructions.

YOU ARE NOT the appointment setter persona. You are the CONTROL INTERFACE for the operator.

CURRENT STATE (provided in each message):
- Agent mode, drafts count, sent today count, scan settings

YOUR CAPABILITIES — respond conversationally AND include action JSON:
1. SCAN_INBOX — Scan LinkedIn conversations for ones needing a response
2. CHANGE_MODE — Switch between off, copilot, auto
3. UPDATE_SETTINGS — Change scan filters (maxAgeDays, phases, limit, autoSend)
4. SHOW_STATS — Show current dashboard stats
5. EXPLAIN — Explain how something works
6. GENERATE_DRAFTS — Generate drafts for chats, optionally with a custom instruction/angle. The user can say things like "focus on recruitment pain points" or "ask about their team growth" and ALL drafts will use this as inspiration while staying natural and adapted per prospect.

RESPONSE FORMAT — Always respond in this exact JSON format:
{
  "message": "Your conversational response to the user in Dutch or English (match their language)",
  "actions": [
    { "type": "SCAN_INBOX", "params": { "maxAgeDays": 7, "limit": 20 } },
    { "type": "CHANGE_MODE", "params": { "mode": "copilot" } },
    { "type": "UPDATE_SETTINGS", "params": { "maxAgeDays": 14, "phases": ["warm", "proof", "call"] } },
    { "type": "GENERATE_DRAFTS", "params": { "instruction": "focus on recruitment pain points", "maxAgeDays": 7 } }
  ]
}

The "actions" array can be empty if no action is needed (just answering a question).
Multiple actions can be in one response.

RULES:
- Be concise, friendly, and professional
- If the user asks to scan, always confirm what parameters you will use
- If changing to auto mode, warn them that messages will be sent automatically
- Match the user's language (Dutch or English)
- Use emoji sparingly but naturally
- If you do not understand, ask for clarification
- When reporting results, be specific with numbers`;

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

    const mode = getAgentMode();
    const drafts = getDrafts();
    const pendingDrafts = drafts.filter(d => d.status === 'pending');
    const approvedDrafts = drafts.filter(d => d.status === 'approved');
    const sentToday = getSentTodayCount();
    const dailyCap = getDailyCapacity(0);
    const scanSettings = getAgentScanSettings();
    const chatHistory = getAgentChatHistory().slice(-10);

    const contextBlock = `CURRENT STATE:
- Mode: ${mode}
- Pending drafts: ${pendingDrafts.length}
- Approved drafts: ${approvedDrafts.length}
- Sent today: ${sentToday}/${dailyCap}
- Scan settings: maxAgeDays=${scanSettings.maxAgeDays}, phases=${scanSettings.phases.length > 0 ? scanSettings.phases.join(',') : 'all'}, limit=${scanSettings.limit}, autoSend=${scanSettings.autoSend}
- LinkedIn connected: ${!!(DSN && API_KEY && ACCOUNT_ID)}`;

    const claudeMessages: { role: string; content: string }[] = [];
    for (const msg of chatHistory.slice(0, -1)) {
      claudeMessages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }
    claudeMessages.push({
      role: 'user',
      content: `${contextBlock}\n\nUSER MESSAGE: ${message}`,
    });

    if (!ANTHROPIC_KEY) {
      const fallbackResponse = {
        message: `Ik begrijp je verzoek, maar de ANTHROPIC_API_KEY is niet geconfigureerd. Status: mode=${mode}, ${pendingDrafts.length} pending drafts.`,
        actions: [] as any[],
      };
      addAgentChatMessage({ role: 'agent', content: fallbackResponse.message, timestamp: new Date().toISOString(), actions: [] });
      return NextResponse.json(fallbackResponse);
    }

    // Call Claude API directly via fetch (no SDK needed)
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: COMMAND_SYSTEM_PROMPT,
        messages: claudeMessages,
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('[Agent Chat] Claude API error:', errText);
      const errorMsg = 'Er ging iets mis met de AI. Probeer het opnieuw.';
      addAgentChatMessage({ role: 'agent', content: errorMsg, timestamp: new Date().toISOString() });
      return NextResponse.json({ message: errorMsg, actions: [], mode });
    }

    const apiData = await apiRes.json();

    let responseText = '';
    for (const block of apiData.content || []) {
      if (block.type === 'text') responseText += block.text;
    }

    let parsed: { message: string; actions: { type: string; params?: any }[] };
    try {
      let cleanJson = responseText.trim();
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      parsed = JSON.parse(cleanJson);
    } catch {
      parsed = { message: responseText, actions: [] };
    }

    const actionResults: { type: string; result: string }[] = [];

    for (const action of parsed.actions || []) {
      switch (action.type) {
        case 'CHANGE_MODE': {
          const newMode = action.params?.mode;
          if (['off', 'copilot', 'auto'].includes(newMode)) {
            setAgentMode(newMode);
            actionResults.push({ type: 'CHANGE_MODE', result: `Mode changed to ${newMode}` });
          }
          break;
        }
        case 'UPDATE_SETTINGS': {
          const updates: any = {};
          if (action.params?.maxAgeDays !== undefined) updates.maxAgeDays = action.params.maxAgeDays;
          if (action.params?.phases !== undefined) updates.phases = action.params.phases;
          if (action.params?.limit !== undefined) updates.limit = action.params.limit;
          if (action.params?.autoSend !== undefined) updates.autoSend = action.params.autoSend;
          updateAgentScanSettings(updates);
          actionResults.push({ type: 'UPDATE_SETTINGS', result: JSON.stringify(updates) });
          break;
        }
        case 'SCAN_INBOX': {
          try {
            if (!DSN || !API_KEY || !ACCOUNT_ID) {
              actionResults.push({ type: 'SCAN_INBOX', result: 'LinkedIn not connected' });
              break;
            }
            const maxAge = action.params?.maxAgeDays || scanSettings.maxAgeDays;
            const cutoffDate = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000);
            const chatsRes = await fetch(`https://${DSN}/api/v1/chats?account_id=${ACCOUNT_ID}&limit=50`, {
              headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' },
              cache: 'no-store',
            });
            if (chatsRes.ok) {
              const chatsData = await chatsRes.json();
              const chats = chatsData.items || chatsData || [];
              const existingDraftChatIds = new Set(
                getDrafts().filter(d => d.status === 'pending' || d.status === 'approved').map(d => d.chat_id)
              );
              let needsAttention = 0, alreadyDrafted = 0, tooOld = 0;
              for (const chat of chats) {
                if (chat.account_id && chat.account_id !== ACCOUNT_ID) continue;
                const lastMsg = chat.last_message;
                const msgDate = lastMsg?.timestamp ? new Date(lastMsg.timestamp) : null;
                if (existingDraftChatIds.has(chat.id)) alreadyDrafted++;
                else if (msgDate && msgDate < cutoffDate) tooOld++;
                else if (lastMsg && !(lastMsg.is_sender || lastMsg.sender?.is_me)) needsAttention++;
              }
              actionResults.push({
                type: 'SCAN_INBOX',
                result: `Scanned ${chats.length} chats: ${needsAttention} need attention, ${alreadyDrafted} already have drafts, ${tooOld} older than ${maxAge} days`,
              });
            } else {
              actionResults.push({ type: 'SCAN_INBOX', result: 'Failed to fetch chats' });
            }
          } catch (err) {
            actionResults.push({ type: 'SCAN_INBOX', result: 'Error: ' + String(err) });
          }
          break;
        }
        case 'GENERATE_DRAFTS': {
          try {
            if (!DSN || !API_KEY || !ACCOUNT_ID) {
              actionResults.push({ type: 'GENERATE_DRAFTS', result: 'LinkedIn not connected' });
              break;
            }
            const maxAge = action.params?.maxAgeDays || scanSettings.maxAgeDays;
            const instruction = action.params?.instruction || '';
            const cutoffDate = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000);
            
            // Fetch chats needing attention
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
              getDrafts().filter(d => d.status === 'pending' || d.status === 'approved').map(d => d.chat_id)
            );
            
            // Filter chats that need attention
            const chatIdsToProcess: string[] = [];
            for (const chat of chats) {
              if (chat.account_id && chat.account_id !== ACCOUNT_ID) continue;
              if (existingDraftChatIds.has(chat.id)) continue;
              const lastMsg = chat.last_message;
              const msgDate = lastMsg?.timestamp ? new Date(lastMsg.timestamp) : null;
              if (msgDate && msgDate < cutoffDate) continue;
              const isSentByMe = lastMsg ? (lastMsg.is_sender || lastMsg.sender?.is_me) : true;
              if (!isSentByMe && lastMsg?.text) chatIdsToProcess.push(chat.id);
            }
            
            if (chatIdsToProcess.length === 0) {
              actionResults.push({ type: 'GENERATE_DRAFTS', result: 'No chats need attention right now' });
              break;
            }
            
            // Call copilot-scan POST internally to generate drafts
            const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000');
            const scanRes = await fetch(`${baseUrl}/api/agent/copilot-scan`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                chat_ids: chatIdsToProcess.slice(0, 10), 
                custom_instruction: instruction 
              }),
            });
            
            if (scanRes.ok) {
              const scanData = await scanRes.json();
              actionResults.push({
                type: 'GENERATE_DRAFTS',
                result: `${scanData.drafts_created || 0} drafts generated for ${chatIdsToProcess.length} chats${instruction ? ' with instruction: "' + instruction.substring(0, 50) + '"' : ''}`,
              });
            } else {
              actionResults.push({ type: 'GENERATE_DRAFTS', result: 'Draft generation failed' });
            }
          } catch (err) {
            actionResults.push({ type: 'GENERATE_DRAFTS', result: 'Error: ' + String(err) });
          }
          break;
        }
                case 'SHOW_STATS': {
          actionResults.push({
            type: 'SHOW_STATS',
            result: `Mode: ${getAgentMode()}, Pending: ${pendingDrafts.length}, Approved: ${approvedDrafts.length}, Sent: ${sentToday}/${dailyCap}`,
          });
          break;
        }
        default:
          actionResults.push({ type: action.type, result: 'Unknown action' });
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
  } catch (error) {
    console.error('[Agent Chat] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    history: getAgentChatHistory(),
    mode: getAgentMode(),
    scan_settings: getAgentScanSettings(),
  });
}
