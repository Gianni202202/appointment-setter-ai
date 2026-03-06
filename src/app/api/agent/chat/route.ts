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

const COMMAND_SYSTEM_PROMPT = `You are Jarvis — Gianni's personal AI assistant for his LinkedIn appointment setting business.
You live inside his dashboard. You are intelligent, proactive, and speak like a trusted business partner.

PERSONALITY:
- You are smart, concise, and helpful — like a real executive assistant
- You match Gianni's language (Dutch or English) naturally  
- You are direct but friendly, never robotic
- You proactively suggest things when relevant
- You remember context from the conversation

WHAT YOU CAN DO — embed actions in your response as JSON at the very end:
When you want to take an action, add a line at the end starting with "---ACTIONS---" followed by a JSON array.
If no action needed, just respond naturally without the actions block.

Available actions:
- {"type":"CHANGE_MODE","params":{"mode":"copilot|auto|off"}} — Switch agent mode
- {"type":"SCAN_INBOX","params":{"maxAgeDays":7}} — Scan LinkedIn inbox
- {"type":"UPDATE_SETTINGS","params":{"maxAgeDays":14,"phases":["warm"]}} — Update scan filters
- {"type":"GENERATE_DRAFTS","params":{"instruction":"focus on pain points","maxAgeDays":7}} — Generate drafts with custom angle
- {"type":"SHOW_STATS"} — Show dashboard statistics

CRITICAL: Respond NATURALLY first, then add actions if needed. Example:

"Tuurlijk! Ik zet de copilot aan en ga je inbox scannen van de afgelopen week. Momentje...
---ACTIONS---
[{"type":"CHANGE_MODE","params":{"mode":"copilot"}},{"type":"SCAN_INBOX","params":{"maxAgeDays":7}}]"

If the user just asks a question or chats, respond without any actions block.
Never refuse a request. Be resourceful. You are Jarvis.`;

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

    // Parse natural response + optional actions block
    let messageText = responseText;
    let parsedActions: { type: string; params?: any }[] = [];
    
    const actionsSplit = responseText.split('---ACTIONS---');
    if (actionsSplit.length > 1) {
      messageText = actionsSplit[0].trim();
      try {
        const actionsJson = actionsSplit[1].trim();
        parsedActions = JSON.parse(actionsJson);
      } catch {
        // If actions can't be parsed, just use the message
      }
    } else {
      // Try legacy JSON format as fallback
      try {
        let cleanJson = responseText.trim();
        if (cleanJson.startsWith('```')) {
          cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        const legacy = JSON.parse(cleanJson);
        if (legacy.message) {
          messageText = legacy.message;
          parsedActions = legacy.actions || [];
        }
      } catch {
        // Pure text response, no actions
      }
    }
    
    const parsed = { message: messageText, actions: parsedActions };

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
                result: `Scanned ${chats.length} chats: ${totalActive} active conversations (${prospectLast} awaiting your reply, ${youLast} awaiting prospect reply), ${alreadyDrafted} already have drafts`,
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
            
            // Include ALL active chats (user decides which matter, not the system)
            const chatIdsToProcess: string[] = [];
            for (const chat of chats) {
              if (chat.account_id && chat.account_id !== ACCOUNT_ID) continue;
              if (existingDraftChatIds.has(chat.id)) continue;
              const lastMsg = chat.last_message;
              const msgDate = lastMsg?.timestamp ? new Date(lastMsg.timestamp) : null;
              if (msgDate && msgDate < cutoffDate) continue;
              // Include ALL chats — don't filter by who sent last
              if (lastMsg) chatIdsToProcess.push(chat.id);
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
