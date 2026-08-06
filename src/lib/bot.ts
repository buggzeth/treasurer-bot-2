// --- START OF FILE bot.ts ---

import { Telegraf, Markup } from 'telegraf';
import { waitUntil } from '@vercel/functions';
import { config } from './config';
import { 
    uploadReceiptImage, 
    insertPendingExpense, 
    updateExpenseStatus, 
    isUserAllowed, 
    addAllowedUser,
    getApprovedExpenses
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
        // Super Admins get the special custom keyboard to pick contacts and export data
        ctx.reply(
            "👋 AI Treasurer is online.\n\nSince you are an Admin, you can process receipts, whitelist new users, or export data using the buttons below.",
            Markup.keyboard([
                [{ 
                    text: '➕ Whitelist New User', 
                    request_users: { request_id: 1, user_is_bot: false } // Opens contact picker
                }],
                [{ 
                    text: '📥 Export Approved Expenses' 
                }]
            ]).resize()
        );
    } else {
        // Standard whitelisted users just see a normal welcome
        ctx.reply("👋 AI Treasurer is online. Send me a receipt image.", Markup.removeKeyboard());
    }
});

// Listener for the Export Data button
bot.hears('📥 Export Approved Expenses', async (ctx) => {
    const isSuperAdmin = config.allowedUsers.includes(ctx.from.id);
    if (!isSuperAdmin) {
        return ctx.reply("⛔ Only admins can export expenses.");
    }

    const loadingMsg = await ctx.reply("⏳ Fetching data and generating CSV...");

    try {
        const expenses = await getApprovedExpenses();
        
        if (expenses.length === 0) {
            return ctx.telegram.editMessageText(
                ctx.chat.id, 
                loadingMsg.message_id, 
                undefined, 
                "ℹ️ No approved expenses found."
            );
        }

        // 1. Define CSV Headers matching your schema
        const headers = [
            'id', 'created_at', 'telegram_user_id', 'merchant_name', 
            'transaction_date', 'total_amount', 'tax_amount', 
            'currency', 'category', 'status', 'receipt_image_url'
        ];

        // 2. Map data to CSV rows, safely escaping commas and quotes
        const csvRows = expenses.map(row => {
            return headers.map(header => {
                let val = row[header];
                if (val === null || val === undefined) val = '';
                
                const str = String(val);
                // Escape quotes and wrap in quotes if the string contains a comma, newline, or quote
                if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            }).join(',');
        });

        // 3. Combine headers and rows
        const csvString = [headers.join(','), ...csvRows].join('\n');
        
        // 4. Convert to Buffer (Telegraf accepts buffers for document uploads)
        const buffer = Buffer.from(csvString, 'utf-8');
        const dateStr = new Date().toISOString().split('T')[0];

        // 5. Send Document & Clean up loading message
        await ctx.replyWithDocument(
            { source: buffer, filename: `approved_expenses_${dateStr}.csv` },
            { caption: `📊 Here is your export of ${expenses.length} approved expenses.` }
        );
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);

    } catch (error) {
        console.error("Export Error:", error);
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            loadingMsg.message_id, 
            undefined, 
            "❌ Database error while generating CSV."
        );
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
