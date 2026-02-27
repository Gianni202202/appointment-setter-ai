import { getConversations } from '@/lib/database';
import ConversationFilters from '@/components/ConversationFilters';

export const dynamic = 'force-dynamic';

export default function ConversationsPage() {
  const conversations = getConversations();
  const active = conversations.filter(c => !['dead', 'booked'].includes(c.state)).length;

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '4px' }}>
          Conversations
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          {conversations.length} total conversations • {active} active
        </p>
      </div>

      <ConversationFilters conversations={conversations} />
    </div>
  );
}
