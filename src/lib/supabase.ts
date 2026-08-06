// --- START OF FILE supabase.ts ---

import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// Create a single supabase client for interacting with your database
export const supabase = createClient(config.supabaseUrl, config.supabaseKey);

export async function uploadReceiptImage(buffer: Buffer, mimeType: string, extension: string): Promise<string> {
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;
    
    const { data, error } = await supabase.storage
        .from('receipt_images')
        .upload(fileName, buffer, {
            contentType: mimeType,
            upsert: false
        });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage
        .from('receipt_images')
        .getPublicUrl(data.path);

    return publicUrlData.publicUrl;
}

export async function insertPendingExpense(expenseData: any, telegramUserId: number, imageUrl: string) {
    const { data, error } = await supabase
        .from('expenses')
        .insert([{
            telegram_user_id: telegramUserId,
            merchant_name: expenseData.merchant_name,
            transaction_date: expenseData.transaction_date,
            total_amount: expenseData.total_amount,
            tax_amount: expenseData.tax_amount,
            currency: expenseData.currency,
            category: expenseData.category,
            receipt_image_url: imageUrl,
            status: 'pending'
        }])
        .select('id')
        .single();

    if (error) throw error;
    return data.id; 
}

export async function updateExpenseStatus(id: string, status: 'approved' | 'rejected') {
    const { error } = await supabase
        .from('expenses')
        .update({ status })
        .eq('id', id);

    if (error) throw error;
}

// === NEW DYNAMIC WHITELIST FUNCTIONS ===

export async function isUserAllowed(telegramId: number): Promise<boolean> {
    const { data, error } = await supabase
        .from('allowed_users')
        .select('telegram_id')
        .eq('telegram_id', telegramId)
        .maybeSingle();
    
    if (error) {
        console.error("Supabase Error checking allowed user:", error);
        return false;
    }
    return !!data; // Returns true if the user exists in the database
}

export async function addAllowedUser(telegramId: number, addedBy: number) {
    const { error } = await supabase
        .from('allowed_users')
        .upsert(
            [{ telegram_id: telegramId, added_by: addedBy }],
            { onConflict: 'telegram_id' } // Fails silently/updates if user already exists
        );

    if (error) throw error;
}

export async function getApprovedExpenses() {
    const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('status', 'approved') // Using 'approved' as set by your inline keyboard action
        .order('transaction_date', { ascending: false });

    if (error) throw error;
    return data || [];
}