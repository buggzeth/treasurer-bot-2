// --- START OF FILE config.ts ---

export const config = {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN!,
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    // Accepts a comma-separated list of keys, falling back to a single key for backwards compatibility
    geminiApiKeys: (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
        .split(',')
        .map(k => k.trim())
        .filter(Boolean),
    // Allowed users parsed into an array of numbers
    allowedUsers: (process.env.ALLOWED_TELEGRAM_USERS || '').split(',').map(id => parseInt(id.trim(), 10)),
};

if (!config.telegramToken || !config.supabaseUrl || !config.supabaseKey || config.geminiApiKeys.length === 0) {
    throw new Error("Missing required environment variables in .env.local");
}