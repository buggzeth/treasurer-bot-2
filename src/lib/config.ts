export const config = {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN!,
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    geminiApiKey: process.env.GEMINI_API_KEY!,
    // Allowed users parsed into an array of numbers
    allowedUsers: (process.env.ALLOWED_TELEGRAM_USERS || '').split(',').map(id => parseInt(id.trim(), 10)),
};

if (!config.telegramToken || !config.supabaseUrl || !config.supabaseKey || !config.geminiApiKey) {
    throw new Error("Missing required environment variables in .env.local");
}