import { UnipileChat, UnipileMessage } from '@/types';

const DSN = process.env.UNIPILE_DSN || '';
const API_KEY = process.env.UNIPILE_API_KEY || '';
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
// Chat / Conversation Endpoints
// ============================================

export async function getChats(): Promise<UnipileChat[]> {
  const data = await unipileRequest('/chats');
  return data.items || data;
}

export async function getChat(chatId: string): Promise<UnipileChat> {
  return unipileRequest(`/chats/${chatId}`);
}

// ============================================
// Message Endpoints
// ============================================

export async function getMessages(chatId: string): Promise<UnipileMessage[]> {
  const data = await unipileRequest(`/chats/${chatId}/messages`);
  return data.items || data;
}

export async function sendMessage(chatId: string, text: string): Promise<UnipileMessage> {
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
// Profile Endpoints
// ============================================

export async function getProfile(accountId: string) {
  return unipileRequest(`/users/${accountId}`);
}

export async function getAccounts() {
  return unipileRequest('/accounts');
}
