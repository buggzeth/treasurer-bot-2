import { Telegraf, Markup } from 'telegraf';
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
        const loadingMsg = await ctx.reply("⏳ Processing via Gemini 3.6 Flash...");

        // 1. Get Image from Telegram
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const response = await fetch(fileLink.href);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 2. Upload to Supabase Storage
        const imageUrl = await uploadReceiptImage(buffer, 'image/jpeg', 'jpg');

        // 3. Process with Gemini
        const base64Image = buffer.toString('base64');
        const extractedData = await processReceiptImage(base64Image, 'image/jpeg');

        // 4. Save to Supabase DB as 'pending'
        const rowId = await insertPendingExpense(extractedData, ctx.from.id, imageUrl);

        // 5. Ask for human verification
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

    } catch (error) {
        console.error(error);
        ctx.reply("❌ Error processing the receipt.");
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