import { getConfig } from '@/lib/database';
import SettingsForm from '@/components/SettingsForm';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const config = getConfig();

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '4px' }}>
          Agent Settings
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Configure how your AI appointment setter behaves
        </p>
      </div>

      <SettingsForm initialConfig={config} />
    </div>
  );
}
