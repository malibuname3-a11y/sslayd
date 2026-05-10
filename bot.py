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
    await update.message.reply_text("Rasm yuboring 📸")

async def photo_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id

    photo = update.message.photo[-1]
    file = await context.bot.get_file(photo.file_id)

    os.makedirs("images", exist_ok=True)
    input_path = f"images/{user_id}.jpg"

    await file.download_to_drive(input_path)

    user_data[user_id] = input_path

    keyboard = [[str(i) for i in range(2, 6)],
                [str(i) for i in range(6, 11)]]

    reply_markup = ReplyKeyboardMarkup(keyboard, one_time_keyboard=True, resize_keyboard=True)

    await update.message.reply_text(
        "Nechta qilib beray? (2–10)",
        reply_markup=reply_markup
    )

async def number_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id

    if user_id not in user_data:
        await update.message.reply_text("Avval rasm yuboring 📸")
        return

    try:
        count = int(update.message.text)
    except:
        await update.message.reply_text("Faqat raqam yuboring (2–10)")
        return

    if count < 2 or count > 10:
        await update.message.reply_text("2 dan 10 gacha tanlang")
        return

    img = Image.open(user_data[user_id])

    w, h = img.size

    # grid (masalan 2x5, 3x3 kabi)
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

    output_path = f"images/output_{user_id}.jpg"
    new_img.save(output_path)

    await update.message.reply_photo(photo=open(output_path, "rb"))

app = ApplicationBuilder().token(TOKEN).build()

app.add_handler(CommandHandler("start", start))
app.add_handler(MessageHandler(filters.PHOTO, photo_handler))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, number_handler))

print("Bot ishlayapti...")

app.run_polling()
