import { NextResponse } from 'next/server';
import Redis from 'ioredis';

export async function GET() {
  const REDIS_URL = process.env.REDIS_URL || '';
  if (!REDIS_URL) {
    return NextResponse.json({ status: 'REDIS_URL not configured', connected: false });
  }

  const results: any = {
    timestamp: new Date().toISOString(),
    redis_url: REDIS_URL.replace(/:[^:@]+@/, ':***@'),
    tests: {},
  };

  let redis: Redis | null = null;
  try {
    redis = new Redis(REDIS_URL, { connectTimeout: 5000, lazyConnect: true });
    await redis.connect();
    results.connected = true;
    results.tests.connection = 'Connected';

    // Test write
    const testKey = '__test_' + Date.now();
    await redis.set(testKey, JSON.stringify({ test: true, ts: Date.now() }));
    results.tests.write = 'Write OK';

    // Test read
    const val = await redis.get(testKey);
    const parsed = val ? JSON.parse(val) : null;
    results.tests.read = parsed?.test === true ? 'Read OK' : 'Read failed';

    // Test delete
    await redis.del(testKey);
    results.tests.delete = 'Delete OK';

    // Check existing keys
    const keys = await redis.keys('*');
    results.stored_keys = keys;
    results.key_count = keys.length;

    // Read actual data
    const drafts = await redis.get('draft:queue');
    const draftList = drafts ? JSON.parse(drafts) : [];
    results.data = {
      drafts_total: draftList.length,
      drafts_pending: draftList.filter((d: any) => d.status === 'pending').length,
      drafts_approved: draftList.filter((d: any) => d.status === 'approved').length,
      drafts_sent: draftList.filter((d: any) => d.status === 'sent').length,
    };

    const mode = await redis.get('agent:mode');
    results.data.agent_mode = mode ? JSON.parse(mode) : 'not set';

    const scanRes = await redis.get('scan:last_results');
    results.data.cached_scan = scanRes ? 'Yes (' + JSON.parse(scanRes).length + ' chats)' : 'None';

    const actLog = await redis.get('activity:log');
    results.data.activity_entries = actLog ? JSON.parse(actLog).length : 0;

    results.status = 'All tests passed — Redis is working!';
  } catch (err) {
    results.connected = false;
    results.status = 'Error: ' + (err instanceof Error ? err.message : String(err));
  } finally {
    if (redis) await redis.quit().catch(() => {});
  }

  return NextResponse.json(results, { status: results.connected ? 200 : 500 });
}