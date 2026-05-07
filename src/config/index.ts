import "dotenv/config";

export const ADMIN_ID = Number(process.env.ADMIN_ID);
export const BOT_TOKEN = process.env.BOT_TOKEN!;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const PRESENTATION_COST = Number(process.env.PRESENTATION_COST) || 100;
export const PEXELS_API_KEY = process.env.PEXELS_API_KEY;



// Channel for daily posts
export const CHANNEL_ID = process.env.CHANNEL_ID || "";

// Referral bonus amount
export const REFERRAL_BONUS = 2000;

// Initial balance for new users
export const INITIAL_BALANCE = 8000;
