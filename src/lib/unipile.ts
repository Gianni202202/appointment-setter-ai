import { UnipileChat, UnipileMessage, Prospect } from '@/types';


const RAW_DSN = process.env.UNIPILE_DSN || '';
const UNIPILE_DSN = RAW_DSN.startsWith('http') ? RAW_DSN : ('https://' + RAW_DSN);
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || '';
const UNIPILE_ACCOUNT_ID = process.env.UNIPILE_ACCOUNT_ID || '';

function headers() {
  return {
    'X-API-KEY': UNIPILE_API_KEY,
    'Content-Type': 'application/json',
    'accept': 'application/json',
  };
}

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// LinkedIn Search (Sales Navigator)
// ============================================
export interface SearchResult {
  type: string;
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  headline: string;
  location: string;
  network_distance: string;
  pending_invitation: boolean;
  open_profile: boolean;
  premium: boolean;
  profile_url: string;
  profile_picture_url: string;
  public_identifier: string;
  member_urn: string;
  current_positions: { company: string; role: string; tenure_at_company?: { years: number } }[];
}

export interface SearchResponse {
  object: string;
  items: SearchResult[];
  paging: { start: number; page_count: number; total_count: number };
  cursor?: string;
}

export async function searchLinkedIn(params: {
  url?: string;
  api?: string;
  category?: string;
  keywords?: string;
  cursor?: string;
}): Promise<SearchResponse> {
  const url = `${UNIPILE_DSN}/api/v1/linkedin/search?account_id=${UNIPILE_ACCOUNT_ID}`;
  
  const body: any = {};
  if (params.url) {
    body.url = params.url;
  } else {
    body.api = params.api || 'sales_navigator';
    body.category = params.category || 'people';
    if (params.keywords) body.keywords = params.keywords;
  }
  if (params.cursor) body.cursor = params.cursor;
  
  console.log('[Unipile Search] Calling:', url);
  console.log('[Unipile Search] Body:', JSON.stringify(body));
  
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
  } catch (fetchErr: any) {
    console.error('[Unipile Search] Fetch failed:', fetchErr.message, 'DSN:', UNIPILE_DSN?.substring(0, 30));
    throw new Error('Unipile API unreachable: ' + fetchErr.message + ' (DSN: ' + (UNIPILE_DSN ? UNIPILE_DSN.substring(0, 30) + '...' : 'EMPTY') + ')');
  }
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Unipile Search] Error response:', response.status, errorText.substring(0, 200));
    throw new Error(`Unipile Search error (${response.status}): ${errorText.substring(0, 200)}`);
  }
  
  return response.json();
}

export function searchResultToProspect(result: SearchResult, source: string, searchQuery?: string): Omit<Prospect, 'id' | 'status' | 'enriched' | 'imported_at' | 'updated_at'> {
  const position = result.current_positions?.[0];
  return {
    provider_id: result.id || result.member_urn,
    public_identifier: result.public_identifier || '',
    name: result.name || `${result.first_name} ${result.last_name}`,
    first_name: result.first_name || '',
    last_name: result.last_name || '',
    headline: result.headline || '',
    company: position?.company || '',
    location: result.location || '',
    profile_url: result.profile_url || '',
    profile_picture_url: result.profile_picture_url || '',
    network_distance: result.network_distance || '',
    source: source as any || 'sales_navigator',
    search_query: searchQuery,
  };
}

// ============================================
// Get Profile (enrichment)
// ============================================
export interface ProfileData {
  first_name: string;
  last_name: string;
  headline: string;
  summary?: string;
  location?: string;
  experience?: {
    company_name: string;
    title: string;
    duration?: string;
    description?: string;
  }[];
  skills?: { name: string }[];
  education?: { school: string; degree: string; field_of_study?: string }[];
}

export async function getProfile(identifier: string, sections: string[] = ['experience', 'skills']): Promise<ProfileData> {
  const sectionsParam = encodeURIComponent(JSON.stringify(sections));
  const url = `${UNIPILE_DSN}/api/v1/users/${encodeURIComponent(identifier)}?account_id=${UNIPILE_ACCOUNT_ID}&linkedin_sections=${sectionsParam}&notify=false`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: headers(),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Unipile Profile error (${response.status}): ${error}`);
  }
  
  return response.json();
}

// ============================================
// Send Invitation
// ============================================
export async function sendInvitation(providerId: string, message?: string): Promise<{ success: boolean; error?: string }> {
  const url = `${UNIPILE_DSN}/api/v1/users/invite`;
  
  const body: any = {
    provider_id: providerId,
    account_id: UNIPILE_ACCOUNT_ID,
  };
  if (message) body.message = message.substring(0, 290); // LinkedIn safe limit (300 max, 290 for safety)
  
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  
  if (response.status === 422) {
    return { success: false, error: 'LinkedIn invite limit reached (cannot_resend_yet)' };
  }
  
  if (response.status === 429) {
    return { success: false, error: 'Rate limited — try again later' };
  }
  
  if (!response.ok) {
    const error = await response.text();
    return { success: false, error: `Unipile error (${response.status}): ${error}` };
  }
  
  return { success: true };
}





// ============================================
// Get User Posts (for enrichment context)
// ============================================
export interface LinkedInPost {
  id: string;
  text: string;
  created_at: string;
  reactions_count?: number;
  comments_count?: number;
  shares_count?: number;
}

export async function getUserPosts(identifier: string, limit: number = 3): Promise<LinkedInPost[]> {
  try {
    const url = `${UNIPILE_DSN}/api/v1/posts/${encodeURIComponent(identifier)}?account_id=${UNIPILE_ACCOUNT_ID}&limit=${limit}&is_own=false`;
    
    console.log('[Unipile Posts] Fetching posts for:', identifier);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: headers(),
    });
    
    if (!response.ok) {
      const err = await response.text();
      console.error('[Unipile Posts] Error:', response.status, err.substring(0, 100));
      return []; // Non-critical — return empty
    }
    
    const data = await response.json();
    const items = data.items || data || [];
    
    // Filter to last 3 months only
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const filtered = items
      .filter((p: any) => {
        // Exclude reposts/reshares — only original content
        if (p.is_repost || p.type === "repost" || p.reshared_post || p.is_reshare) return false;
        // Exclude if no meaningful text
        if (!p.text && !p.body) return false;
        // Filter to last 3 months only
        if (!p.created_at) return true;
        return new Date(p.created_at) >= threeMonthsAgo;
      })
      .slice(0, limit)
      .map((p: any) => ({
        id: p.id || p.social_id || '',
        text: (p.text || p.body || '').substring(0, 500),
        created_at: p.created_at || '',
        reactions_count: p.reactions_count || p.likes_count || 0,
        comments_count: p.comments_count || 0,
        shares_count: p.shares_count || p.reposts_count || 0,
      }));
    
    console.log('[Unipile Posts] Got', filtered.length, 'recent posts for', identifier);
    return filtered;
  } catch (error: any) {
    console.error('[Unipile Posts] Failed:', error.message);
    return []; // Non-critical
  }
}

// ============================================
// LEGACY: Chat/Message functions (used by webhooks + queue)
// ============================================
async function unipileRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${UNIPILE_DSN}/api/v1${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'X-API-KEY': UNIPILE_API_KEY,
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

export async function verifyChatOwnership(chatId: string): Promise<boolean> {
  if (!UNIPILE_ACCOUNT_ID) return false;
  try {
    const chat = await unipileRequest(`/chats/${chatId}`);
    return !chat.account_id || chat.account_id === UNIPILE_ACCOUNT_ID;
  } catch {
    return false;
  }
}

export async function getChats(): Promise<UnipileChat[]> {
  if (!UNIPILE_ACCOUNT_ID) throw new Error('UNIPILE_ACCOUNT_ID not configured');
  const data = await unipileRequest(`/chats?account_id=${UNIPILE_ACCOUNT_ID}`);
  return data.items || data;
}

export async function getChat(chatId: string): Promise<UnipileChat> {
  const chat = await unipileRequest(`/chats/${chatId}`);
  if (UNIPILE_ACCOUNT_ID && chat.account_id && chat.account_id !== UNIPILE_ACCOUNT_ID) {
    throw new Error('Access denied: chat does not belong to configured account');
  }
  return chat;
}

export async function getMessages(chatId: string): Promise<UnipileMessage[]> {
  if (UNIPILE_ACCOUNT_ID) {
    const isOwner = await verifyChatOwnership(chatId);
    if (!isOwner) throw new Error('Access denied: chat does not belong to configured account');
  }
  const data = await unipileRequest(`/chats/${chatId}/messages`);
  return data.items || data;
}

export async function sendMessage(chatId: string, text: string): Promise<UnipileMessage> {
  if (!UNIPILE_ACCOUNT_ID) throw new Error('UNIPILE_ACCOUNT_ID not configured');
  const isOwner = await verifyChatOwnership(chatId);
  if (!isOwner) throw new Error('BLOCKED: Cannot send message to chat from another account');

  const formData = new FormData();
  formData.append('text', text);
  formData.append('linkedin_messaging_type', 'LINKEDIN');

  return unipileRequest(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: formData,
    headers: {
      'X-API-KEY': UNIPILE_API_KEY,
      'Accept': 'application/json',
    },
  });
}

export async function getOwnAccount() {
  if (!UNIPILE_ACCOUNT_ID) throw new Error('UNIPILE_ACCOUNT_ID not configured');
  return unipileRequest(`/accounts/${UNIPILE_ACCOUNT_ID}`);
}

export function getAccountId(): string {
  return UNIPILE_ACCOUNT_ID;
}
