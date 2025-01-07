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
bot.command('global', commands.globalRatingCommand);
bot.hears('👤 Мой профиль', commands.profileCommand);
bot.hears('🔍 Начать оценивать', commands.startRatingCommand);
bot.hears('👑 Лидеры', commands.leadersCommand);
bot.hears('⭐️ Кто меня оценил', commands.whoRatedMeCommand);
bot.hears('🌍 Глобальный рейтинг', commands.globalRatingCommand);

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

async function startBot() {
    try {
        await bot.launch();
        console.log('Бот успешно запущен');
        
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

async function announceGlobalRating(bot) {
    try {
        const users = await db.getAllUsers();
        const message = `🌟 *Внимание! Начался новый раунд глобальной оценки!*\n\n` +
                       `🎯 Стоимость участия: 50 монет\n` +
                       `🎯 Успейте принять участие и получить шанс выиграть:\n` +
                       `👑 Первое место - 500 монет\n` +
                       `🥈 Второе место - 300 монет\n` +
                       `🥉 Третье место - 100 монет\n\n` +
                       `Нажмите /global или кнопку "🌍 Глобальный рейтинг" чтобы участвовать!`;

        for (const user of users) {
            try {
                await bot.telegram.sendMessage(user.user_id, message, {
                    parse_mode: 'Markdown'
                });
            } catch (error) {
                console.error(`Ошибка отправки объявления пользователю ${user.user_id}:`, error);
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    } catch (error) {
        console.error('Ошибка при отправке объявлений:', error);
    }
}

setInterval(async () => {
    try {
        const currentRound = await db.getCurrentGlobalRound();
        if (!currentRound || new Date(currentRound.rating_end_time) <= new Date()) {
            const winners = await db.finishGlobalRound();
            
            // Отправляем сообщения победителям
            for (let i = 0; i < Math.min(3, winners.length); i++) {
                const winner = winners[i];
                const coins = i === 0 ? 500 : i === 1 ? 300 : i === 2 ? 100 : 0;
                await bot.telegram.sendMessage(
                    winner.user_id,
                    `🎉 Поздравляем! Вы заняли ${i + 1} место в глобальной оценке и получили ${coins} монет!`
                );
            }

            // Создаем новый раунд и отправляем объявление
            await db.createGlobalRound();
            await announceGlobalRating(bot);
        }
    } catch (error) {
        console.error('Ошибка обновления глобального раунда:', error);
    }
}, 5 * 60 * 1000); // 5 минут

// Добавляем команду для ручного запуска глобального раунда (для администраторов)
bot.command('startglobalround', async (ctx) => {
    if (ctx.from.id === config.ADMIN_ID) { // Убедитесь, что у вас есть ADMIN_ID в конфиге
        try {
            await db.createGlobalRound();
            await announceGlobalRating(bot);
            await ctx.reply('Новый глобальный раунд успешно запущен!');
        } catch (error) {
            console.error('Ошибка запуска глобального раунда:', error);
            await ctx.reply('Произошла ошибка при запуске глобального раунда');
        }
    }
});

bot.action('join_global', async (ctx) => {
    try {
        const participantsCount = await db.getGlobalRatingParticipantsCount();
        if (participantsCount >= 10) {
            await ctx.answerCbQuery('Достигнуто максимальное количество участников!');
            return;
        }

        await db.joinGlobalRating(ctx.from.id);
        await ctx.answerCbQuery('Вы успешно присоединились к глобальной оценке!');
        await commands.globalRatingCommand(ctx);
    } catch (error) {
        await ctx.answerCbQuery(error.message);
    }
});

bot.action('view_global_profiles', async (ctx) => {
    try {
        const profiles = await db.getGlobalRatingParticipants();
        const currentProfile = profiles[0]; // Показываем первый профиль

        if (!currentProfile) {
            await ctx.reply('Нет доступных анкет для оценки.');
            return;
        }

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '❤️ Нравится', callback_data: `vote_global_${currentProfile.user_id}` },
                    { text: '➡️ Следующая', callback_data: 'next_global_profile' }
                ]
            ]
        };

        const caption = `👤 *${currentProfile.name}*, ${currentProfile.age}\n` +
                       `🌆 ${currentProfile.city}\n` +
                       `${currentProfile.description ? `📝 ${currentProfile.description}\n` : ''}`;

        if (currentProfile.photos && currentProfile.photos.length > 0) {
            await ctx.replyWithPhoto(currentProfile.photos[0], {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else {
            await ctx.reply(caption, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    } catch (error) {
        console.error('Ошибка при показе анкет:', error);
        await ctx.reply('Произошла ошибка при загрузке анкет.');
    }
});

bot.action(/^vote_global_(\d+)$/, async (ctx) => {
    try {
        const targetId = parseInt(ctx.match[1]);
        const voterId = ctx.from.id;

        if (voterId === targetId) {
            await ctx.answerCbQuery('Вы не можете голосовать за себя!');
            return;
        }

        await db.saveGlobalVote(voterId, targetId);
        await ctx.answerCbQuery('Ваш голос учтен!');
        
        // Показываем следующий профиль
        await showNextGlobalProfile(ctx);
    } catch (error) {
        console.error('Ошибка при голосовании:', error);
        await ctx.answerCbQuery('Произошла ошибка при голосовании');
    }
});

bot.action('next_global_profile', async (ctx) => {
    try {
        await showNextGlobalProfile(ctx);
    } catch (error) {
        console.error('Ошибка при показе следующего профиля:', error);
        await ctx.answerCbQuery('Произошла ошибка');
    }
});

// Добавьте вспомогательную функцию для показа следующего профиля
async function showNextGlobalProfile(ctx) {
    const voterId = ctx.from.id;
    const profiles = await db.getGlobalRatingParticipants(voterId);
    
    if (!profiles || profiles.length === 0) {
        await ctx.reply('Вы просмотрели все доступные анкеты.');
        return;
    }

    const currentProfile = profiles[0];
    const keyboard = {
        inline_keyboard: [
            [
                { text: '❤️ Нравится', callback_data: `vote_global_${currentProfile.user_id}` },
                { text: '➡️ Следующая', callback_data: 'next_global_profile' }
            ]
        ]
    };

    const caption = `👤 *${currentProfile.name}*, ${currentProfile.age}\n` +
                   `🌆 ${currentProfile.city}\n` +
                   `${currentProfile.description ? `📝 ${currentProfile.description}\n` : ''}`;

    try {
        await ctx.editMessageCaption(caption, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } catch (error) {
        // Если не удалось отредактировать сообщение, отправляем новое
        if (currentProfile.photos && currentProfile.photos.length > 0) {
            await ctx.replyWithPhoto(currentProfile.photos[0], {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else {
            await ctx.reply(caption, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    }
}

module.exports = {
    bot,
    startBot
};