// --- START OF FILE route.ts ---

import { NextRequest, NextResponse } from 'next/server';
import { bot } from '@/lib/bot';

// Allow Vercel to keep this serverless instance alive up to its max Hobby limit.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: any) {
    try {
        const update = await request.json();

        // Inject standard Vercel background execution context into the update object 
        // This stops Next.js/Vercel from killing the instance the moment NextResponse is returned
        if (context && typeof context.waitUntil === 'function') {
            update.waitUntil = context.waitUntil.bind(context);
        }

        await bot.handleUpdate(update);

        // Telegram webhook is successfully acknowledged instantly.
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