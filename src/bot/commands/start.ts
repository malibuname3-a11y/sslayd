import TelegramBot from "node-telegram-bot-api";
import User from "../../models/User.js";
import { mainMenu } from "../keyboards/mainMenu.js";
import { logger } from "../../utils/logger.js";
import { PRESENTATION_COST, REFERRAL_BONUS, INITIAL_BALANCE } from "../../config/index.js";
import { formatAmount } from "../../utils/formatter.js";


export default function startCommand(bot: TelegramBot) {
  bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id!;
    const name = msg.from?.first_name || "Foydalanuvchi";

    try {
      const referralId = match?.[1] ? Number(match[1]) : null;

      let user = await User.findOne({ telegramId: userId });
      let isNewUser = false;

      if (!user) {
        user = await User.create({
          telegramId: userId,
          name,
          referredBy: referralId || null,
          action: "start",
          balance: INITIAL_BALANCE,
        });
        
        isNewUser = true;
        logger.info("New user registered", { userId, name, referralId, initialBalance: INITIAL_BALANCE });
        
        // If referred, give bonus to referrer
        if (referralId) {
          try {
            const referrer = await User.findOne({ telegramId: referralId });
            if (referrer && referrer.telegramId !== userId) {
              referrer.balance += REFERRAL_BONUS;
              await referrer.save();
              
              // Send notification to referrer
              try {
                await bot.sendMessage(
                  referralId,
                  `🎉 *Mukofot puli!*

Do'stingiz botdan foydalanishni boshladi va sizga ${formatAmount(REFERRAL_BONUS)} mukofot puli qo'shildi!

💰 *Yangi balansingiz:* ${formatAmount(referrer.balance)}

🎁 Do'stlaringizni taklif qilishda davom eting va yana mukofotlar oling!`,
                  { parse_mode: "Markdown" }
                );
              } catch (error: any) {
                logger.warn("Could not send referral bonus notification", { referrerId: referralId, error });
              }
              
              logger.info("Referral bonus given", { 
                newUserId: userId, 
                referrerId: referralId, 
                bonus: REFERRAL_BONUS 
              });
            }
          } catch (error: any) {
            logger.error("Error giving referral bonus", error);
          }
        }
      } else {
        await User.findOneAndUpdate(
          { telegramId: userId },
          { name, action: "start" }
        );
      }

      // Check subscription
      const isSubscribed = await checkSubscription(bot, userId);
      
      if (!isSubscribed) {
        const subscriptionMsg = getSubscriptionMessage();
        if (subscriptionMsg) {
          const channelUsername = process.env.REQUIRED_CHANNEL_USERNAME || "";
          return bot.sendMessage(
            chatId,
            subscriptionMsg,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "📢 Kanalga o'tish",
                      url: channelUsername ? `https://t.me/${channelUsername}` : undefined,
                    },
                  ],
                  [
                    {
                      text: "✅ Obuna bo'ldim",
                      callback_data: "check_subscription",
                    },
                  ],
                ],
              },
            }
          );
        }
      }

      const welcomeMessage = isNewUser
        ? `Assalomu alaykum, ${name}! 👋

🎉 *Xush kelibsiz!*

💰 Sizga ${formatAmount(INITIAL_BALANCE)} boshlang'ich balans berildi!

📌 Botimiz yordamida REFERAT, TAQDIMOT, MUSTAQIL ISH, SLAYD tayorlashingiz mumkin.

✨ *Qanday ishlaydi:*
1️⃣ "📊 Taqdimot yaratish" tugmasini bosing
2️⃣ Mavzuni yuboring
3️⃣ Professional taqdimot oling!

💰 *Narx:* ${formatAmount(PRESENTATION_COST)} har bir taqdimot uchun

🎁 *Referal Tizimi:*
Do'stlaringizni taklif qiling va har bir taklif uchun ${formatAmount(REFERRAL_BONUS)} mukofot oling!

📘 Qo'llanma - botdan qanday foydalanish haqida ma'lumot.
/vid - 📕 Taqdimot (Slayd) video qo'llanma
/video - 📘 Referat/Mustaqil ish video qo'llanma`
        : `Assalomu alaykum, ${name}! 👋

📌 Botimiz yordamida REFERAT, TAQDIMOT, MUSTAQIL ISH, SLAYD tayorlashingiz mumkin.

✨ *Qanday ishlaydi:*
1️⃣ "📊 Taqdimot yaratish" tugmasini bosing
2️⃣ Mavzuni yuboring
3️⃣ Professional taqdimot oling!

💰 *Narx:* ${formatAmount(PRESENTATION_COST)} har bir taqdimot uchun

🎁 *Referal Tizimi:*
Do'stlaringizni taklif qiling va har bir taklif uchun ${formatAmount(REFERRAL_BONUS)} mukofot oling!

📘 Qo'llanma - botdan qanday foydalanish haqida ma'lumot.
/vid - 📕 Taqdimot (Slayd) video qo'llanma
/video - 📘 Referat/Mustaqil ish video qo'llanma`;

      await bot.sendMessage(
        chatId,
        welcomeMessage,
        { parse_mode: "Markdown", ...mainMenu }
      );
    } catch (error: any) {
      logger.error("Error in start command", error);
      await bot.sendMessage(
        chatId,
        "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
      );
    }
  });
}
