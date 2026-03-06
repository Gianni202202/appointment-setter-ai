import { NextResponse } from 'next/server';
import { getLearningStats } from '@/lib/self-learning';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = await getLearningStats();
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
