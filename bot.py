import os
from PIL import Image
from telegram import Update, ReplyKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

TOKEN = os.getenv("BOT_TOKEN")

# user state
user_state = {}

# /start
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("📸 Rasm yuboring")

# photo handler
async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id

    photo = update.message.photo[-1]
    file = await context.bot.get_file(photo.file_id)

    os.makedirs("images", exist_ok=True)
    path = f"images/{user_id}.jpg"

    await file.download_to_drive(path)

    # state saqlash
    user_state[user_id] = {
        "path": path
    }

    keyboard = ReplyKeyboardMarkup(
        [["📦 Grid (2-10)", "📤 Alohida yuborish"]],
        resize_keyboard=True
    )

    await update.message.reply_text("Rejim tanlang:", reply_markup=keyboard)

# text handler
async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    text = update.message.text

    if user_id not in user_state:
        await update.message.reply_text("Avval rasm yuboring 📸")
        return

    data = user_state[user_id]
    path = data["path"]

    img = Image.open(path)
    w, h = img.size

    # 📦 GRID MODE
    if text == "📦 Grid (2-10)":
        user_state[user_id]["mode"] = "grid"
        await update.message.reply_text("Nechta nusxa? (2–10)")
        return

    # 📤 SINGLE MODE
    if text == "📤 Alohida yuborish":
        user_state[user_id]["mode"] = "single"
        await update.message.reply_text("Nechta rasm yuboray? (2–10)")
        return

    # GRID PROCESS
    if data.get("mode") == "grid":
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

    # SINGLE PROCESS
    if data.get("mode") == "single":
        try:
            count = int(text)
        except:
            await update.message.reply_text("Raqam kiriting (2–10)")
            return

        if count < 2 or count > 10:
            await update.message.reply_text("2–10 orasida tanlang")
            return

        for _ in range(count):
            await update.message.reply_photo(photo=open(path, "rb"))

        return


# app
app = ApplicationBuilder().token(TOKEN).build()

app.add_handler(CommandHandler("start", start))
app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

print("Bot ishlayapti...")

app.run_polling(drop_pending_updates=True)
