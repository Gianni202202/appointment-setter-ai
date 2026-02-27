import { UnipileChat, UnipileMessage } from '@/types';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
const ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';
const BASE_URL = `https://${DSN}/api/v1`;

async function unipileRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'X-API-KEY': API_KEY,
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Unipile API error (${response.status}): ${error}`);
  }

  return response.json();
}

// ============================================
// SECURITY: Account ownership verification
// ============================================

export async function verifyChatOwnership(chatId: string): Promise<boolean> {
  if (!ACCOUNT_ID) return false;
  try {
    const chat = await unipileRequest(`/chats/${chatId}`);
    return !chat.account_id || chat.account_id === ACCOUNT_ID;
  } catch {
    return false;
  }
}

// ============================================
// Chat / Conversation Endpoints
// ============================================

export async function getChats(): Promise<UnipileChat[]> {
  // SECURITY: Only fetch chats for our account
  if (!ACCOUNT_ID) throw new Error('UNIPILE_ACCOUNT_ID not configured');
  const data = await unipileRequest(`/chats?account_id=${ACCOUNT_ID}`);
  return data.items || data;
}

export async function getChat(chatId: string): Promise<UnipileChat> {
  const chat = await unipileRequest(`/chats/${chatId}`);
  // SECURITY: Verify chat belongs to our account
  if (ACCOUNT_ID && chat.account_id && chat.account_id !== ACCOUNT_ID) {
    throw new Error('Access denied: chat does not belong to configured account');
  }
  return chat;
}

// ============================================
// Message Endpoints
// ============================================

export async function getMessages(chatId: string): Promise<UnipileMessage[]> {
  // SECURITY: Verify ownership before reading messages
  if (ACCOUNT_ID) {
    const isOwner = await verifyChatOwnership(chatId);
    if (!isOwner) throw new Error('Access denied: chat does not belong to configured account');
  }
  const data = await unipileRequest(`/chats/${chatId}/messages`);
  return data.items || data;
}

export async function sendMessage(chatId: string, text: string): Promise<UnipileMessage> {
  // SECURITY: Verify ownership BEFORE sending any message
  if (!ACCOUNT_ID) throw new Error('UNIPILE_ACCOUNT_ID not configured — cannot send messages');
  const isOwner = await verifyChatOwnership(chatId);
  if (!isOwner) throw new Error('BLOCKED: Cannot send message to chat from another account');

  const formData = new FormData();
  formData.append('text', text);

  return unipileRequest(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: formData,
    headers: {
      'X-API-KEY': API_KEY,
      'Accept': 'application/json',
    },
  });
}

// ============================================
// Account Endpoints
// ============================================

export async function getOwnAccount() {
  // SECURITY: Only return our configured account, never list all
  if (!ACCOUNT_ID) throw new Error('UNIPILE_ACCOUNT_ID not configured');
  return unipileRequest(`/accounts/${ACCOUNT_ID}`);
}

export function getAccountId(): string {
  return ACCOUNT_ID;
}
