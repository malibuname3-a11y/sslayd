import TelegramBot from "node-telegram-bot-api";
import Payment from "../../models/Payment.js";
import { ADMIN_ID, PRESENTATION_COST } from "../../config/index.js";
import User from "../../models/User.js";
import { logger } from "../../utils/logger.js";
import { formatAmount, formatNumber } from "../../utils/formatter.js";
import { generatePresentation } from "../../services/aiService.js";
import { generatePPTX } from "../../services/pptxService.js";
import { getProgressMessage } from "../../utils/progressBar.js";
import { deductBalance } from "../../services/balanceService.js";
import { mainMenu } from "../keyboards/mainMenu.js";
import { handleBroadcastCallback } from "../commands/broadcast.js";
import fs from "fs";
import path from "path";

const BOT_USERNAME = process.env.BOT_USERNAME || "talaba_ai_robot";

const CARD = "8600 5304 0271 3039";
const NAME_ON_CARD = "AXMEDOV ABBOSBEK";

// Payment amounts available
const PAYMENT_AMOUNTS = [
  1000, 2000, 3000, 5000, 10000, 15000, 20000, 25000, 30000,
];

export default async function callbackHandler(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery
) {
  const chatId = query.message!.chat.id;
  const data = query.data!;
  const userId = query.from?.id;

  // Handle broadcast callbacks first
  if (data?.startsWith("broadcast_")) {
    try {
      await handleBroadcastCallback(bot, query);
    } catch (error: any) {
      logger.error("Error in broadcast callback handler", error);
    }
    return;
  }

  // Handle guide navigation
  if (data?.startsWith("guide_")) {
    try {
      const { GUIDE_PAGES, getGuideKeyboard } = await import("../../utils/guideMessages.js");
      
      let pageIndex = 0;
      if (data.startsWith("guide_next_")) {
        pageIndex = parseInt(data.replace("guide_next_", "")) + 1;
      } else if (data.startsWith("guide_prev_")) {
        pageIndex = parseInt(data.replace("guide_prev_", "")) - 1;
      }

      if (pageIndex < 0) pageIndex = 0;
      if (pageIndex >= GUIDE_PAGES.length) pageIndex = GUIDE_PAGES.length - 1;

      await bot.answerCallbackQuery(query.id);
      
      await bot.editMessageText(GUIDE_PAGES[pageIndex].text, {
        chat_id: chatId,
        message_id: query.message!.message_id!,
        parse_mode: "Markdown",
        ...getGuideKeyboard(pageIndex),
      });
    } catch (error: any) {
      logger.error("Error handling guide navigation", error);
      await bot.answerCallbackQuery(query.id, { text: "❌ Xatolik yuz berdi!" });
    }
    return;
  }

  // Handle subscription check
  if (data === "check_subscription") {
    try {
      const isSubscribed = await checkSubscription(bot, userId!);
      
      if (isSubscribed) {
        await bot.answerCallbackQuery(query.id, { text: "✅ Obuna tasdiqlandi!" });
        await bot.deleteMessage(chatId, query.message!.message_id!);
        
        // Send welcome message
        const user = await User.findOne({ telegramId: userId! });
        const name = user?.name || query.from.first_name || "Foydalanuvchi";
        
        await bot.sendMessage(
          chatId,
          `Assalomu alaykum, ${name}! 👋

📌 Botimiz yordamida REFERAT, TAQDIMOT, MUSTAQIL ISH, SLAYD tayorlashingiz mumkin.

✨ *Qanday ishlaydi:*
1️⃣ "📊 Taqdimot yaratish" tugmasini bosing
2️⃣ Mavzuni yuboring
3️⃣ Professional taqdimot oling!

💰 *Narx:* ${formatAmount(PRESENTATION_COST)} har bir taqdimot uchun

📘 Qo'llanma - botdan qanday foydalanish haqida ma'lumot.
/vid - 📕 Taqdimot (Slayd) video qo'llanma
/video - 📘 Referat/Mustaqil ish video qo'llanma`,
          { parse_mode: "Markdown", ...mainMenu }
        );
      } else {
        await bot.answerCallbackQuery(query.id, { text: "❌ Kanalga obuna bo'lmadingiz!" });
        const subscriptionMsg = getSubscriptionMessage();
        if (subscriptionMsg) {
          const channelUsername = process.env.REQUIRED_CHANNEL_USERNAME || "";
          await bot.editMessageText(subscriptionMsg, {
            chat_id: chatId,
            message_id: query.message!.message_id!,
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
          });
        }
      }
      return;
    } catch (error: any) {
      logger.error("Error checking subscription", error);
      await bot.answerCallbackQuery(query.id, { text: "❌ Xatolik yuz berdi!" });
      return;
    }
  }

  try {
    await bot.answerCallbackQuery(query.id);

    // Handle payment-related callbacks (available to all users)
    switch (data) {
    case "payment":
        try {
          // Show amount selection buttons
          const amountButtons = [];
          for (let i = 0; i < PAYMENT_AMOUNTS.length; i += 2) {
            const row = [];
            row.push({
              text: formatAmount(PAYMENT_AMOUNTS[i]),
              callback_data: `select_amount_${PAYMENT_AMOUNTS[i]}`,
            });
            if (i + 1 < PAYMENT_AMOUNTS.length) {
              row.push({
                text: formatAmount(PAYMENT_AMOUNTS[i + 1]),
                callback_data: `select_amount_${PAYMENT_AMOUNTS[i + 1]}`,
              });
            }
            amountButtons.push(row);
          }

          await bot.sendMessage(
            chatId,
            `💰 *To'lov miqdorini tanlang:*

Quyidagi summalardan birini tanlang:`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: amountButtons,
              },
            }
          );
          await bot.deleteMessage(chatId, query!.message!.message_id!);
        } catch (error: any) {
          logger.error("Error handling payment callback", error);
        }
        return;

      // Handle amount selection
      default:
        if (data.startsWith("select_amount_")) {
          try {
            const amount = Number(data.replace("select_amount_", ""));

            if (!userId) {
              return bot.sendMessage(chatId, "❌ Xatolik yuz berdi.");
            }

            const user = await User.findOne({ telegramId: userId });
            if (!user) {
              return bot.sendMessage(chatId, "❌ Foydalanuvchi topilmadi.");
            }

            // Store selected amount in user action
            user.action = `payment_amount:${amount}`;
            await user.save();

      await bot.sendMessage(
        chatId,
              `✅ *${formatAmount(amount)}* tanlandi.

Quyidagi karta raqamiga to'lov qiling va chekni skrinshot qilib oling (COPY qilish uchun karta raqam ustiga bosing).

💳 \`${CARD}\`
👤 ${NAME_ON_CARD}

📸 To'lov chekini yuboring:`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                        text: "❌ Bekor qilish",
                        callback_data: "cancel_payment",
                },
              ],
            ],
          },
        }
      );
            await bot.deleteMessage(chatId, query!.message!.message_id!);
          } catch (error: any) {
            logger.error("Error handling amount selection", error);
            await bot.sendMessage(
              chatId,
              "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
            );
          }
          return;
        }

        if (data === "cancel_payment") {
          try {
            if (!userId) {
              return bot.sendMessage(chatId, "❌ Xatolik yuz berdi.");
            }

            const user = await User.findOne({ telegramId: userId });
            if (user) {
              user.action = "start";
              await user.save();
            }

            await bot.deleteMessage(chatId, query!.message!.message_id!);
            await bot.sendMessage(chatId, "❌ To'lov bekor qilindi.");
          } catch (error: any) {
            logger.error("Error canceling payment", error);
          }
          return;
        }
      break;
    }

    // Handle skip author
    if (data === "skip_author") {
      try {
        if (!userId) {
          return bot.sendMessage(chatId, "❌ Xatolik yuz berdi.");
        }

        const user = await User.findOne({ telegramId: userId });
        if (!user || !user.presentationState) {
          return bot.sendMessage(
            chatId,
            "❌ Xatolik yuz berdi. /start buyrug'ini bosing."
          );
        }

        // Set default author name
        user.presentationState.author = "Talaba AI Bot";
        user.action = "waiting_for_pages";
        await user.save();

        await bot.answerCallbackQuery(query.id, { text: "✅ Muallif o'tkazib yuborildi" });
        await bot.deleteMessage(chatId, query.message!.message_id!);

        return bot.sendMessage(
          chatId,
          `✅ Muallif: *Talaba AI Bot*

🧮 Endi *taqdimot sahifalar sonini* kiritishingizni so'raymiz.

📄 Sahifalar soni: *4-16* orasida bo'lishi kerak.

Raqam yuboring (masalan: 8, 10, 12):`,
          { parse_mode: "Markdown" }
        );
      } catch (error: any) {
        logger.error("Error skipping author", error);
        await bot.answerCallbackQuery(query.id, { text: "❌ Xatolik yuz berdi!" });
      }
      return;
    }

    // Handle template selection
    if (data.startsWith("select_template_")) {
      try {
        if (!userId) {
          return bot.sendMessage(chatId, "❌ Xatolik yuz berdi.");
        }

        const user = await User.findOne({ telegramId: userId });
        if (!user || !user.presentationState) {
          return bot.sendMessage(
            chatId,
            "❌ Xatolik yuz berdi. /start buyrug'ini bosing."
          );
        }

        const template = Number(data.replace("select_template_", ""));
        user.presentationState.template = template;
        user.action = "waiting_for_language";
        await user.save();

        // Show language selection
        await bot.sendMessage(
          chatId,
          `✅ Shablon ${template} tanlandi.

🌐 Endi *taqdimot tilini* tanlang:`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🇺🇿 O'zbek", callback_data: "select_language_uzbek" }],
                [{ text: "🇷🇺 Rus", callback_data: "select_language_rus" }],
                [
                  {
                    text: "🇬🇧 Ingliz",
                    callback_data: "select_language_ingliz",
                  },
                ],
                [{ text: "🇩🇪 Nemis", callback_data: "select_language_nemis" }],
                [
                  {
                    text: "🇫🇷 Fransuz",
                    callback_data: "select_language_fransuz",
                  },
                ],
              ],
            },
          }
        );
        await bot.deleteMessage(chatId, query!.message!.message_id!);
      } catch (error: any) {
        logger.error("Error handling template selection", error);
        await bot.sendMessage(
          chatId,
          "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
        );
      }
      return;
    }

    // Handle language selection
    if (data.startsWith("select_language_")) {
      try {
        if (!userId) {
          return bot.sendMessage(chatId, "❌ Xatolik yuz berdi.");
        }

        const user = await User.findOne({ telegramId: userId });
        if (!user || !user.presentationState) {
          return bot.sendMessage(
            chatId,
            "❌ Xatolik yuz berdi. /start buyrug'ini bosing."
          );
        }

        const language = data.replace("select_language_", "");
        user.presentationState.language = language;
        user.action = "confirming_presentation";
        await user.save();

        // Show confirmation post
        const state = user.presentationState;

        // Validate all required fields
        if (!state.topic || !state.author || !state.pages || !state.template) {
          logger.error("Missing presentation state fields", { state, userId });
          return bot.sendMessage(
            chatId,
            "❌ Ma'lumotlar to'liq emas. Iltimos, qaytadan boshlang.",
            { ...mainMenu }
          );
        }

        const languageNames: Record<string, string> = {
          uzbek: "🇺🇿 O'zbek",
          rus: "🇷🇺 Rus",
          ingliz: "🇬🇧 Ingliz",
          nemis: "🇩🇪 Nemis",
          fransuz: "🇫🇷 Fransuz",
        };

        // Template image URLs (placeholder - you'll need to add actual image URLs)
        const templateImages: Record<number, string> = {
          1: "../../assets/blank-blue-background-for-ppt-and-presentation-free-vector.jpg",
          2: "../../assets/blank-blue-background-for-ppt-and-presentation-free-vector.jpg",
        };

        const templateImage =
          templateImages[state.template] || templateImages[1];

        try {
          await bot.sendPhoto(chatId, templateImage, {
            caption: `📊 *Taqdimot ma'lumotlari*

📌 *Mavzu:* ${state.topic}
🧑‍🎓 *Muallif:* ${state.author}
📄 *Sahifalar soni:* ${state.pages}
📐 *Shablon:* ${state.template}
🌐 *Til:* ${languageNames[language] || language}

💰 Narx: ${formatAmount(PRESENTATION_COST)}

👇 Quyidagilardan birini tanlang:`,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ Tayyorlash",
                    callback_data: "confirm_presentation",
                  },
                ],
                [
                  {
                    text: "❌ Rad etish",
                    callback_data: "cancel_presentation",
                  },
                  {
                    text: "✏️ O'zgartirish",
                    callback_data: "edit_presentation",
                  },
                ],
              ],
            },
          });
        } catch (photoError: any) {
          // If photo fails, send text message instead
          logger.warn("Failed to send photo, sending text instead", photoError);
          await bot.sendMessage(
            chatId,
            `📊 *Taqdimot ma'lumotlari*

📌 *Mavzu:* ${state.topic}
🧑‍🎓 *Muallif:* ${state.author}
📄 *Sahifalar soni:* ${state.pages}
📐 *Shablon:* ${state.template}
🌐 *Til:* ${languageNames[language] || language}

💰 Narx: ${formatAmount(PRESENTATION_COST)}

👇 Quyidagilardan birini tanlang:`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "✅ Tayyorlash",
                      callback_data: "confirm_presentation",
                    },
                  ],
                  [
                    {
                      text: "❌ Rad etish",
                      callback_data: "cancel_presentation",
                    },
                    {
                      text: "✏️ O'zgartirish",
                      callback_data: "edit_presentation",
                    },
                  ],
                ],
              },
            }
          );
        }

        try {
          await bot.deleteMessage(chatId, query!.message!.message_id!);
        } catch (deleteError) {
          // Ignore delete errors
        }
      } catch (error: any) {
        logger.error("Error handling language selection", error);
        await bot.sendMessage(
          chatId,
          `❌ Xatolik yuz berdi: ${
            error.message || "Noma'lum xatolik"
          }. Iltimos, qayta urinib ko'ring.`
        );
      }
      return;
    }

    // Handle presentation confirmation
    if (data === "confirm_presentation") {
      try {
        if (!userId) {
          return bot.sendMessage(chatId, "❌ Xatolik yuz berdi.");
        }

        const user = await User.findOne({ telegramId: userId });
        if (!user || !user.presentationState) {
          return bot.sendMessage(
            chatId,
            "❌ Xatolik yuz berdi. /start buyrug'ini bosing."
          );
        }

        const state = user.presentationState;

        // Check balance
        if (user.balance < PRESENTATION_COST) {
          user.action = "start";
          user.presentationState = {};
          await user.save();

          return bot.sendMessage(
            chatId,
            `❌ *Balans yetarli emas*\n\n💰 Balansingiz: ${formatAmount(
              user.balance
            )}\n💵 Kerak: ${formatAmount(
              PRESENTATION_COST
            )}\n\nIltimos, balansingizni to'ldiring.`,
            { parse_mode: "Markdown", ...mainMenu }
          );
        }

        // Deduct balance
        const balanceDeducted = await deductBalance(userId, PRESENTATION_COST);
        if (!balanceDeducted) {
          user.action = "start";
          user.presentationState = {};
          await user.save();

          return bot.sendMessage(chatId, `❌ Balans yetarli emas.`, {
            ...mainMenu,
          });
        }

        // Send progress message
        let progressMsg = await bot.sendMessage(chatId, getProgressMessage(0), {
          parse_mode: "Markdown",
        });

        // Update progress
        const updateProgress = async (step: number) => {
          try {
            await bot.editMessageText(getProgressMessage(step), {
              chat_id: chatId,
              message_id: progressMsg.message_id,
              parse_mode: "Markdown",
            });
          } catch (error) {
            // Ignore edit errors
          }
        };

        // Generate presentation
        await updateProgress(3);
        const presentation = await generatePresentation(
          state.topic!,
          state.pages!,
          state.language!
        );

        if (!presentation) {
          await bot.editMessageText(
            `❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring yoki admin bilan bog'laning.`,
            { chat_id: chatId, message_id: progressMsg.message_id }
          );
          user.action = "start";
          user.presentationState = {};
          await user.save();
          return;
        }

        // Generate PPTX
        await updateProgress(7);
        let pptxBuffer: Buffer;
        try {
          pptxBuffer = await generatePPTX({
            topic: state.topic!,
            author: state.author!,
            pages: state.pages!,
            template: state.template!,
            language: state.language!,
            slides: presentation.slides,
          });
        } catch (pptxError: any) {
          logger.error("PPTX generation failed", {
            error: pptxError,
            message: pptxError?.message,
            stack: pptxError?.stack,
          });

          await bot.editMessageText(
            `❌ PPTX fayl yaratishda xatolik yuz berdi.\n\nXatolik: ${
              pptxError?.message || "Noma'lum xatolik"
            }\n\nIltimos, qayta urinib ko'ring yoki admin bilan bog'laning.`,
            { chat_id: chatId, message_id: progressMsg.message_id }
          );

          user.action = "start";
          user.presentationState = {};
          await user.save();
          return;
        }

        // Save to temp file
        const tempDir = path.join(process.cwd(), "temp");
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        const fileName = `presentation_${userId}_${Date.now()}.pptx`;
        const filePath = path.join(tempDir, fileName);
        fs.writeFileSync(filePath, pptxBuffer);

        // Delete progress message
        await bot.deleteMessage(chatId, progressMsg.message_id);

        // Send PPTX file
        await updateProgress(10);
        const caption = `📊 *${presentation.title}*

🧑‍🎓 Muallif: ${state.author}
📄 Sahifalar: ${state.pages}
📐 Shablon: ${state.template}
🌐 Til: ${state.language}

🤖 @${BOT_USERNAME.replace(/_/g, '\\_')}
💡 Professional taqdimotlar yaratish uchun Talaba AI Bot dan foydalaning!`;

        await bot.sendDocument(chatId, filePath, {
          caption: caption,
        });

        // Clean up
        fs.unlinkSync(filePath);

        // Reset user state
        user.action = "start";
        user.presentationState = {};
        await user.save();

        // Send balance update
        const updatedUser = await User.findOne({ telegramId: userId });
        await bot.sendMessage(
          chatId,
          `✅ Taqdimot tayyorlandi!\n\n💰 Balansingiz: ${formatAmount(
            updatedUser?.balance || 0
          )}`,
          { ...mainMenu }
        );

        logger.info("Presentation created successfully", {
          userId,
          topic: state.topic,
          pages: state.pages,
        });
      } catch (error: any) {
        logger.error("Error creating presentation", error);
        await bot.sendMessage(
          chatId,
          "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring.",
          { ...mainMenu }
        );
      }
      return;
    }

    // Handle presentation cancellation
    if (data === "cancel_presentation") {
      try {
        if (!userId) {
          return bot.sendMessage(chatId, "❌ Xatolik yuz berdi.");
        }

        const user = await User.findOne({ telegramId: userId });
        if (user) {
          user.action = "start";
          user.presentationState = {};
          await user.save();
        }

        await bot.deleteMessage(chatId, query!.message!.message_id!);
        await bot.sendMessage(chatId, "❌ Taqdimot yaratish bekor qilindi.", {
          ...mainMenu,
        });
      } catch (error: any) {
        logger.error("Error canceling presentation", error);
      }
      return;
    }

    // Handle presentation edit
    if (data === "edit_presentation") {
      try {
        if (!userId) {
          return bot.sendMessage(chatId, "❌ Xatolik yuz berdi.");
        }

        const user = await User.findOne({ telegramId: userId });
        if (user) {
          user.action = "waiting_for_topic";
          user.presentationState = {};
          await user.save();
        }

        await bot.deleteMessage(chatId, query!.message!.message_id!);
        await bot.sendMessage(
          chatId,
          `📌 *Taqdimot yaratish*\n\nIltimos, mavzuni *to'liq, bexato va tushunarli* xolatda yuboring.`,
          { parse_mode: "Markdown" }
        );
      } catch (error: any) {
        logger.error("Error editing presentation", error);
      }
      return;
    }

    // Admin-only callbacks
  if (chatId !== ADMIN_ID) {
    return bot.sendMessage(chatId, "⛔ Bu tugma faqat admin uchun.");
  }

  // ✔️ Tasdiqlash
  if (data.startsWith("approve_")) {
      try {
    const paymentId = data.replace("approve_", "");
        const messageId = query.message?.message_id;
        const chatIdForEdit = query.message?.chat.id;

    const pay = await Payment.findById(paymentId);
        if (!pay) {
          return bot.sendMessage(ADMIN_ID, "❌ Payment topilmadi.");
        }

        // Check if already processed
        if (pay.status !== "pending") {
          return bot.sendMessage(
            ADMIN_ID,
            `⚠️ Bu to'lov allaqachon ${
              pay.status === "approved" ? "tasdiqlangan" : "bekor qilingan"
            }.`
          );
        }

    const user = await User.findOne({ telegramId: pay.userId });
        if (!user) {
          return bot.sendMessage(ADMIN_ID, "❌ User topilmadi.");
        }

        // Use amount from payment record
        const amount = pay.amount || 0;

        if (amount <= 0) {
          return bot.sendMessage(ADMIN_ID, "❌ To'lov miqdori noto'g'ri.");
        }

    user.balance += amount;
    await user.save();

    pay.status = "approved";
    await pay.save();

        // Edit the original message to remove buttons and show approved status
        if (messageId && chatIdForEdit) {
          try {
            await bot.editMessageCaption(
              `✅ *To'lov tasdiqlandi*

ID: ${paymentId}
👤 ${user.name}
🆔 Telegram ID: ${user.telegramId}
💰 Summa: *${formatAmount(amount)}*
💵 Yangi balans: ${formatAmount(user.balance)}`,
              {
                chat_id: chatIdForEdit,
                message_id: messageId,
                parse_mode: "Markdown",
              }
            );
          } catch (error: any) {
            logger.warn("Could not edit message", { error });
            // Fallback: send new message if edit fails
            await bot.sendMessage(
      ADMIN_ID,
              `✅ To'lov tasdiqlandi.\n\n👤 ${user.name}\n💰 +${formatAmount(
                amount
              )}\n💵 Yangi balans: ${formatAmount(user.balance)}`
            );
          }
        }

        try {
          await bot.sendMessage(
      user.telegramId,
            `🎉 To'lovingiz tasdiqlandi! +${formatAmount(
              amount
            )} tushdi.\n\n💰 Yangi balansingiz: ${formatAmount(user.balance)}`
          );
        } catch (error: any) {
          logger.warn("Could not send message to user", {
            userId: user.telegramId,
            error,
          });
        }

        logger.info("Payment approved", {
          paymentId,
          userId: user.telegramId,
          amount,
        });
      } catch (error: any) {
        logger.error("Error approving payment", error);
        await bot.sendMessage(
          ADMIN_ID,
          "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
        );
      }
      return;
  }

  // ❌ Bekor qilish
  if (data.startsWith("reject_")) {
      try {
    const paymentId = data.replace("reject_", "");
        const messageId = query.message?.message_id;
        const chatIdForEdit = query.message?.chat.id;

    const pay = await Payment.findById(paymentId);

        if (!pay) {
          return bot.sendMessage(ADMIN_ID, "❌ Payment topilmadi.");
        }

        // Check if already processed
        if (pay.status !== "pending") {
          return bot.sendMessage(
            ADMIN_ID,
            `⚠️ Bu to'lov allaqachon ${
              pay.status === "approved" ? "tasdiqlangan" : "bekor qilingan"
            }.`
          );
        }

    pay.status = "rejected";
    await pay.save();

        // Get user info for the message
        const user = await User.findOne({ telegramId: pay.userId });
        const userName = user?.name || `ID: ${pay.userId}`;

        // Edit the original message to remove buttons and show rejected status
        if (messageId && chatIdForEdit) {
          try {
            await bot.editMessageCaption(
              `❌ *To'lov bekor qilindi*

ID: ${paymentId}
👤 ${userName}
🆔 Telegram ID: ${pay.userId}
💰 Summa: ${formatAmount(pay.amount)}`,
              {
                chat_id: chatIdForEdit,
                message_id: messageId,
                parse_mode: "Markdown",
              }
            );
          } catch (error: any) {
            logger.warn("Could not edit message", { error });
            // Fallback: send new message if edit fails
            await bot.sendMessage(ADMIN_ID, "❌ To'lov bekor qilindi.");
          }
        }

        try {
          await bot.sendMessage(
            pay.userId,
            "❌ To'lovingiz admin tomonidan bekor qilindi."
          );
        } catch (error: any) {
          logger.warn("Could not send message to user", {
            userId: pay.userId,
            error,
          });
        }

        logger.info("Payment rejected", { paymentId, userId: pay.userId });
      } catch (error: any) {
        logger.error("Error rejecting payment", error);
        await bot.sendMessage(
          ADMIN_ID,
          "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
        );
      }
      return;
    }
  } catch (error: any) {
    logger.error("Error in callback handler", error);
    try {
      await bot.sendMessage(
        chatId,
        "❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring."
      );
    } catch (sendError: any) {
      logger.error("Could not send error message", sendError);
    }
  }
}
