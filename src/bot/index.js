const { Telegraf, Scenes, session } = require('telegraf');
const config = require('../config');
const commands = require('./commands');
const middleware = require('./middleware');
const { registrationScene, editProfileScene } = require('../scenes');
const { mainMenu } = require('../utils/keyboards');
const db = require('../database');

const bot = new Telegraf(config.BOT_TOKEN);

// Создаем менеджер сцен
const stage = new Scenes.Stage([registrationScene, editProfileScene]);

// Middleware
bot.use(session());
bot.use(stage.middleware());
bot.use(middleware.errorHandler);
bot.use(middleware.userCheck);
bot.use(middleware.rateLimit);

// Команды
bot.command('start', commands.startCommand);
bot.hears('👤 Мой профиль', commands.profileCommand);
bot.hears('🔍 Начать оценивать', commands.startRatingCommand);
bot.hears('👑 Лидеры', commands.leadersCommand);
bot.hears('⭐️ Кто меня оценил', commands.whoRatedMeCommand);

// Обработчики кнопок
bot.action('edit_profile', async (ctx) => {
    await ctx.scene.enter('edit_profile');
});

bot.action(/^rate_(\d+)_(\d+)$/, async (ctx) => {
    try {
        const [, targetId, rating] = ctx.match.map(Number);
        const result = await db.saveRating(targetId, ctx.from.id, rating);
        
        await ctx.answerCbQuery('Оценка сохранена!');
        
        if (result?.isMutualHigh) {
            const targetUser = await db.getUserProfile(targetId);
            await ctx.reply(`🎉 Взаимная симпатия!\n` +
                          `${targetUser.name} тоже высоко оценил(а) вас!\n` +
                          `${targetUser.username ? `Telegram: @${targetUser.username}` : ''}`);
        }
        
        const nextProfile = await db.getNextProfile(ctx.from.id);
        if (nextProfile) {
            await sendProfileForRating(ctx, nextProfile);
        } else {
            await ctx.reply('На сегодня анкеты закончились. Приходите позже!', mainMenu);
        }
    } catch (error) {
        console.error('Ошибка при сохранении оценки:', error);
        await ctx.answerCbQuery('Произошла ошибка при сохранении оценки');
    }
});

bot.action('skip_profile', async (ctx) => {
    try {
        const nextProfile = await db.getNextProfile(ctx.from.id);
        if (nextProfile) {
            await sendProfileForRating(ctx, nextProfile);
        } else {
            await ctx.reply('На сегодня анкеты закончились. Приходите позже!', mainMenu);
        }
    } catch (error) {
        console.error('Ошибка при пропуске профиля:', error);
        await ctx.answerCbQuery('Произошла ошибка');
    }
});

// Вспомогательные функции
async function sendProfileForRating(ctx, profile) {
    const ratingKeyboard = {
        inline_keyboard: [
            Array.from({ length: 5 }, (_, i) => ({
                text: `${i + 1}⭐️`,
                callback_data: `rate_${profile.user_id}_${i + 1}`
            })),
            Array.from({ length: 5 }, (_, i) => ({
                text: `${i + 6}⭐️`,
                callback_data: `rate_${profile.user_id}_${i + 6}`
            })),
            [{ text: '⏩ Пропустить', callback_data: 'skip_profile' }]
        ]
    };

    const caption = `👤 *${profile.name}*, ${profile.age}\n` +
                   `🌆 ${profile.city}\n` +
                   `${profile.description ? `📝 ${profile.description}\n` : ''}`;

    if (profile.photos && profile.photos.length > 0) {
        await ctx.replyWithPhoto(profile.photos[0], {
            caption: caption,
            parse_mode: 'Markdown',
            reply_markup: ratingKeyboard
        });
    } else {
        await ctx.reply(caption, {
            parse_mode: 'Markdown',
            reply_markup: ratingKeyboard
        });
    }
}

// Запуск бота
async function startBot() {
    try {
        await bot.launch();
        console.log('Бот успешно запущен');
        
        // Запускаем обновление победителей каждые 10 секунд
        setInterval(async () => {
            try {
                const winners = await db.updateWinners();
                if (winners && winners.length > 0) {
                    for (const winner of winners) {
                        if (winner.coins_won > 0) {
                            try {
                                await bot.telegram.sendMessage(
                                    winner.user_id,
                                    `🎉 Поздравляем! Вы заняли ${winner.place} место и получили ${winner.coins_won} монет!`
                                );
                            } catch (error) {
                                console.error(`Ошибка отправки уведомления пользователю ${winner.user_id}:`, error);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Ошибка при обновлении победителей:', error);
            }
        }, 10000);

    } catch (error) {
        console.error('Ошибка при запуске бота:', error);
    }
}

module.exports = {
    bot,
    startBot
}; 