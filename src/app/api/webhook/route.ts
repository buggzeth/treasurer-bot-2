import { NextResponse } from 'next/server';
import { bot } from '@/lib/bot'; // Next.js App Router allows beautiful absolute imports

// Telegram sends webhooks as POST requests
export async function POST(request: Request) {
    try {
        // App router parses JSON natively via Web Standards
        const update = await request.json();

        // Feed the update directly to our Telegraf instance
        await bot.handleUpdate(update);

        return NextResponse.json({ status: 'Success' }, { status: 200 });
    } catch (error) {
        console.error('Webhook Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// A simple GET request so you can visit the URL in your browser to check if it's alive
export async function GET() {
    return new NextResponse('🤖 Treasurer Webhook is active.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
    });
}