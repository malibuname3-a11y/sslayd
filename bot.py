from telegram import Update, ReplyKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    MessageHandler,
    CommandHandler,
    ContextTypes,
    filters,
)
from PIL import Image
import os

TOKEN = os.getenv("BOT_TOKEN")

user_data = {}

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("📸 Rasm yuboring")

async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id

    photo = update.message.photo[-1]
    file = await context.bot.get_file(photo.file_id)

    os.makedirs("images", exist_ok=True)
    input_path = f"images/{user_id}.jpg"

    await file.download_to_drive(input_path)

    user_data[user_id] = input_path

    keyboard = ReplyKeyboardMarkup(
        [
            ["📦 Grid (2-10)", "📤 Alohida yuborish"],
        ],
        resize_keyboard=True
    )

    await update.message.reply_text(
        "Rejimni tanlang:",
        reply_markup=keyboard
    )

async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    text = update.message.text

    if user_id not in user_data:
        await update.message.reply_text("Avval rasm yuboring 📸")
        return

    input_path = user_data[user_id]
    img = Image.open(input_path)
    w, h = img.size

    # 📦 GRID MODE
    if text == "📦 Grid (2-10)":
        keyboard = ReplyKeyboardMarkup(
            [[str(i) for i in range(2, 6)],
             [str(i) for i in range(6, 11)]],
            resize_keyboard=True
        )
        await update.message.reply_text("Nechta nusxa? (2–10)", reply_markup=keyboard)
        user_data[user_id] = {"mode": "grid", "path": input_path}
        return

    # 📤 ALohida yuborish
    if text == "📤 Alohida yuborish":
        await update.message.reply_text("Nechta rasm yuboray? (2–10)")
        user_data[user_id] = {"mode": "single", "path": input_path}
        return

    # GRID PROCESS
    if isinstance(user_data[user_id], dict) and user_data[user_id].get("mode") == "grid":
        try:
            count = int(text)
        except:
            await update.message.reply_text("Raqam kiriting (2–10)")
            return

        if count < 2 or count > 10:
            await update.message.reply_text("2–10 orasida tanlang")
            return

        cols = min(count, 5)
        rows = (count + cols - 1) // cols

        new_img = Image.new("RGB", (w * cols, h * rows))

        idx = 0
        for y in range(rows):
            for x in range(cols):
                if idx >= count:
                    break
                new_img.paste(img, (x * w, y * h))
                idx += 1

        out = f"images/grid_{user_id}.jpg"
        new_img.save(out)

        await update.message.reply_photo(photo=open(out, "rb"))
        return

    # 📤 ALohida yuborish PROCESS
    if isinstance(user_data[user_id], dict) and user_data[user_id].get("mode") == "single":
        try:
            count = int(text)
        except:
            await update.message.reply_text("Raqam kiriting (2–10)")
            return

        if count < 2 or count > 10:
            await update.message.reply_text("2–10 orasida tanlang")
            return

        for _ in range(count):
            await update.message.reply_photo(photo=open(input_path, "rb"))

        return

app = ApplicationBuilder().token(TOKEN).build()

app.add_handler(CommandHandler("start", start))
app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

print("Bot ishlayapti...")

app.run_polling()
