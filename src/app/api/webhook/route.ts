// --- START OF FILE route.ts ---

import { NextRequest, NextResponse } from 'next/server';
import { bot } from '@/lib/bot'; 

// Force Vercel to allow up to 60 seconds (Hobby Tier Maximum)
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const update = await request.json();

        // Feed the update directly to Telegraf
        await bot.handleUpdate(update);

        // Instantly acknowledge Telegram so it doesn't retry the webhook
        return NextResponse.json({ status: 'Success' }, { status: 200 });
    } catch (error) {
        console.error('Webhook Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function GET() {
    return new NextResponse('🤖 Treasurer Webhook is active.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
    });
}