// --- START OF FILE bot.ts ---

import { Telegraf, Markup } from 'telegraf';
import { waitUntil } from '@vercel/functions';
import { config } from './config';
import { uploadReceiptImage, insertPendingExpense, updateExpenseStatus } from './supabase';
import { processReceiptImage } from './gemini';

export const bot = new Telegraf(config.telegramToken);

// Middleware: Ignore anyone not in ALLOWED_TELEGRAM_USERS
bot.use(async (ctx, next) => {
    if (ctx.from && config.allowedUsers.includes(ctx.from.id)) {
        return next();
    }
    if (ctx.chat) {
        await ctx.reply("⛔ Unauthorized access.");
    }
});

bot.start((ctx) => {
    ctx.reply("👋 AI Treasurer is online. Send me a receipt image.");
});

bot.on('photo', async (ctx) => {
    try {
        // Acknowledge immediately so the user knows it's working
        const loadingMsg = await ctx.reply("⏳ Processing in background. You can close the app...");

        // Define the heavy lifting
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

                // Update the loading message with the results
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

        // Tell Vercel to keep this function alive until processTask is done
        // (Up to the 60 seconds defined in maxDuration)
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