// --- START OF FILE bot.ts ---

import { Telegraf, Markup } from 'telegraf';
import { waitUntil } from '@vercel/functions';
import { config } from './config';
import { 
    uploadReceiptImage, 
    insertPendingExpense, 
    updateExpenseStatus, 
    isUserAllowed, 
    addAllowedUser 
} from './supabase';
import { processReceiptImage } from './gemini';

export const bot = new Telegraf(config.telegramToken);

// Middleware: Check both Admin (.env) and Dynamic Whitelist (Supabase)
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    // 1. Are they listed in the environment variables? (Super Admins)
    const isSuperAdmin = config.allowedUsers.includes(userId);
    if (isSuperAdmin) {
        return next();
    }

    // 2. Are they dynamically whitelisted in Supabase? (Standard Users)
    const isWhitelisted = await isUserAllowed(userId);
    if (isWhitelisted) {
        return next();
    }

    // Not authorized
    if (ctx.chat) {
        await ctx.reply("⛔ Unauthorized access. You are not whitelisted.");
    }
});

bot.start((ctx) => {
    const isSuperAdmin = config.allowedUsers.includes(ctx.from.id);

    if (isSuperAdmin) {
        // Super Admins get the special custom keyboard to pick contacts
        ctx.reply(
            "👋 AI Treasurer is online.\n\nSince you are an Admin, you can process receipts OR whitelist new users from your contacts using the button below.",
            Markup.keyboard([
                [{ 
                    text: '➕ Whitelist New User', 
                    request_users: { request_id: 1, user_is_bot: false } // Opens contact picker
                }]
            ]).resize()
        );
    } else {
        // Standard whitelisted users just see a normal welcome
        ctx.reply("👋 AI Treasurer is online. Send me a receipt image.", Markup.removeKeyboard());
    }
});

// Listener for when a Super Admin selects a contact to whitelist
bot.on('message', async (ctx, next) => {
    const msg = ctx.message as any;
    const isSuperAdmin = config.allowedUsers.includes(ctx.from.id);

    // Telegram sends a 'users_shared' or 'user_shared' event back with the ID(s)
    if (msg.users_shared || msg.user_shared) {
        if (!isSuperAdmin) {
            return ctx.reply("⛔ Only admins can whitelist new users.");
        }

        try {
            // Unify response for both Telegram Bot API 7.0+ and 6.5
            const sharedUsers = msg.users_shared?.users || [{ user_id: msg.user_shared.user_id }];
            
            for (const user of sharedUsers) {
                await addAllowedUser(user.user_id, ctx.from.id);
            }
            
            return ctx.reply(`✅ Successfully whitelisted ${sharedUsers.length} user(s). They can now message the bot directly!`);
        } catch (error) {
            console.error("Error adding allowed user:", error);
            return ctx.reply("❌ Database error while trying to whitelist user.");
        }
    }
    
    return next();
});

bot.on('photo', async (ctx) => {
    try {
        const loadingMsg = await ctx.reply("⏳ Processing in background. You can close the app...");

        const processTask = async () => {
            try {
                const photo = ctx.message.photo[ctx.message.photo.length - 1];
                const fileLink = await ctx.telegram.getFileLink(photo.file_id);
                const response = await fetch(fileLink.href);
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                const imageUrl = await uploadReceiptImage(buffer, 'image/jpeg', 'jpg');
                const base64Image = buffer.toString('base64');
                
                const extractedData = await processReceiptImage(base64Image, 'image/jpeg');
                const rowId = await insertPendingExpense(extractedData, ctx.from.id, imageUrl);

                const text = 
                    `🧾 *Receipt Parsed*\n\n` +
                    `*Merchant:* ${extractedData.merchant_name}\n` +
                    `*Date:* ${extractedData.transaction_date}\n` +
                    `*Total:* ${extractedData.total_amount} ${extractedData.currency}\n` +
                    `*Category:* ${extractedData.category}\n\n` +
                    `Save to database?`;

                await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, undefined, text, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        Markup.button.callback('✅ Approve', `approve_${rowId}`),
                        Markup.button.callback('❌ Reject', `reject_${rowId}`)
                    ])
                });
            } catch (error: any) {
                console.error("Background Processing Error:", error);
                await ctx.telegram.editMessageText(
                    ctx.chat.id, 
                    loadingMsg.message_id, 
                    undefined, 
                    `❌ Error processing the receipt. Reason: ${error.message || "Unknown error"}`
                );
            }
        };

        waitUntil(processTask());

    } catch (error) {
        console.error("Initial handler error:", error);
        ctx.reply("❌ Error starting the process.");
    }
});

bot.action(/approve_(.+)/, async (ctx) => {
    await updateExpenseStatus(ctx.match[1], 'approved');
    await ctx.editMessageText("✅ *Expense approved and recorded!*", { parse_mode: 'Markdown' });
});

bot.action(/reject_(.+)/, async (ctx) => {
    await updateExpenseStatus(ctx.match[1], 'rejected');
    await ctx.editMessageText("❌ *Expense rejected and discarded.*", { parse_mode: 'Markdown' });
});