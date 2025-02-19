const { Telegraf, Scenes, session } = require('telegraf');
const config = require('../config');
const commands = require('./commands');
const middleware = require('./middleware');
const { registrationScene, editProfileScene } = require('../scenes');
const { mainMenu } = require('../utils/keyboards');
const db = require('../database');
const { startPeriodicTop10Updates } = require('./commands');

const bot = new Telegraf(config.BOT_TOKEN);
const stage = new Scenes.Stage([registrationScene, editProfileScene]);

bot.use(session());
bot.use(stage.middleware());
bot.use(middleware.errorHandler);
bot.use(middleware.rateLimit);

// Добавляем глобальный обработчик ошибок
bot.catch((error, ctx) => {
    console.error(`Ошибка для update ${ctx.update.update_id}:`, error);
    
    // Проверяем блокировку бота
    if (error.description?.includes('bot was blocked') || 
        error.message?.includes('bot was blocked') ||
        error.code === 403) {
        try {
            const userId = ctx.from?.id || ctx.update?.my_chat_member?.from?.id;
            if (userId) {
                db.updateUserStatus(userId, false)
                    .catch(err => console.error('Ошибка обновления статуса пользователя:', err));
                console.log(`Пользователь ${userId} заблокировал бота`);
            }
        } catch (e) {
            console.error('Ошибка при обработке блокировки:', e);
        }
    }
    
    // Пытаемся ответить пользователю только если это не ошибка блокировки
    if (!error.code === 403 && ctx.chat) {
        try {
            ctx.reply('Произошла ошибка. Пожалуйста, попробуйте еще раз или используйте /start')
                .catch(err => console.error('Ошибка отправки сообщения об ошибке:', err));
        } catch (e) {
            console.error('Ошибка при попытке ответить на ошибку:', e);
        }
    }
});

// Регистрируем команду start до middleware проверки подписки
bot.command('start', async (ctx, next) => {
    try {
        const chatMember = await ctx.telegram.getChatMember('@meetik_info', ctx.from.id);
        
        if (['creator', 'administrator', 'member'].includes(chatMember.status)) {
            return commands.startCommand(ctx, next);
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '📢 Подписаться на канал', url: 'https://t.me/meetik_info' }],
                [{ text: '🔄 Проверить подписку', callback_data: 'check_subscription' }]
            ]
        };

        await ctx.reply(
            '👋 Добро пожаловать!\n\n❗️ Для использования бота необходимо подписаться на наш канал @meetik_info',
            { reply_markup: keyboard }
        );
    } catch (error) {
        console.error('Ошибка при проверке подписки:', error);
        await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
    }
});

// Остальные middleware
bot.use(middleware.checkSubscription);
bot.use(middleware.userCheck);

bot.command('global', commands.globalRatingCommand);
bot.hears('👤 Мой профиль', commands.profileCommand);
bot.hears('🔍 Начать оценивать', commands.startRatingCommand);
bot.hears('👑 Лидеры', commands.leadersCommand);
bot.hears('⭐️ Кто меня оценил', commands.whoRatedMeCommand(bot));
bot.hears('🌍 Глобальный рейтинг', commands.globalRatingCommand);
bot.hears('💰 Баланс', commands.balanceCommand);

bot.action('edit_profile', async (ctx) => {
    await ctx.scene.enter('edit_profile');
});

commands.registerBotActions(bot);

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

        setInterval(async () => {
            const participantsCount = await db.getGlobalRatingParticipantsCount();
            if (participantsCount >= 10) {
                await notifyParticipantsReady();
            }
        }, 60000);

        startPeriodicTop10Updates(bot);

    } catch (error) {
        console.error('Ошибка при запуске бота:', error);
    }
}

async function notifyParticipantsReady() {
    const users = await db.getAllUsers();
    const message = `🎉 Все 10 участников зарегистрировались! Теперь вы можете оценивать анкеты!`;

    for (const user of users) {
        try {
            await bot.telegram.sendMessage(user.user_id, message, {
                parse_mode: 'Markdown'
            });
        } catch (error) {
            console.error(`Ошибка отправки уведомления пользователю ${user.user_id}:`, error);
        }
    }
}

setInterval(async () => {
    try {
        const currentRound = await db.getCurrentGlobalRound();
        const now = new Date();
        
        if (!currentRound) {
            console.log('Создание нового раунда...');
            await db.createGlobalRound();
        } else {
            const endTime = new Date(currentRound.rating_end_time);
            const isInRewardPhase = currentRound.is_reward_phase;
            
            if (!isInRewardPhase && now >= endTime) {
                console.log('Завершение основной фазы раунда...');
                
                const results = await db.finishGlobalRound();
                if (results && results.notifications) {
                    // Отправляем уведомления всем участникам
                    for (const notification of results.notifications) {
                        try {
                            await bot.telegram.sendMessage(
                                notification.user_id,
                                notification.message
                            );
                        } catch (error) {
                            console.error(`Ошибка отправки уведомления пользователю ${notification.user_id}:`, error);
                        }
                    }
                }

                // Создаем новый раунд
                await db.createGlobalRound();
            }
        }
    } catch (error) {
        console.error('Ошибка обновления глобального раунда:', error);
    }
}, 10 * 1000); // Проверка каждые 10 секунд

async function sendWinnersMessage(bot, userId, winners) {
    try {
        const topWinners = winners.slice(0, 3);
        if (topWinners.length === 0) return;

        await sendWinnerProfile(bot, userId, topWinners[0], 0, topWinners.length);

        bot.action(/winners_prev_(\d+)/, async (ctx) => {
            const index = parseInt(ctx.match[1]);
            const newIndex = index > 0 ? index - 1 : topWinners.length - 1;
            await ctx.answerCbQuery();
            await sendWinnerProfile(bot, ctx.from.id, topWinners[newIndex], newIndex, topWinners.length);
        });

        bot.action(/winners_next_(\d+)/, async (ctx) => {
            const index = parseInt(ctx.match[1]);
            const newIndex = index < topWinners.length - 1 ? index + 1 : 0;
            await ctx.answerCbQuery();
            await sendWinnerProfile(bot, ctx.from.id, topWinners[newIndex], newIndex, topWinners.length);
        });
    } catch (error) {
        console.error('Ошибка отправки сообщения о победителях:', error);
    }
}

async function sendWinnerProfile(bot, userId, winner, currentIndex, totalWinners) {
    const place = currentIndex + 1;
    const medals = ['🥇', '🥈', '🥉'];
    const prizes = [500, 300, 100];

    const keyboard = {
        inline_keyboard: [
            [
                { text: '⬅️', callback_data: `winners_prev_${currentIndex}` },
                { text: `${currentIndex + 1}/${totalWinners}`, callback_data: 'winners_count' },
                { text: '➡️', callback_data: `winners_next_${currentIndex}` }
            ]
        ]
    };

    const photos = await db.getUserPhotos(winner.user_id);
    const caption = `${medals[currentIndex]} *${place} место*\n\n` +
                   `👤 *${winner.name}*, ${winner.age} лет\n` +
                   `🌆 ${winner.city}\n` +
                   `${winner.description ? `📝 ${winner.description}\n` : ''}` +
                   `\n💫 Набрано голосов: ${winner.total_votes}\n` +
                   `💰 Получено монет: ${prizes[currentIndex]}`;

    if (photos.length > 0) {
        await bot.telegram.sendPhoto(userId, photos[0], {
            caption: caption,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } else {
        await bot.telegram.sendMessage(userId, caption, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
}

bot.command('startglobalround', async (ctx) => {
    if (ctx.from.id === config.ADMIN_ID) {
        try {
            await db.createGlobalRound();
            await ctx.reply('Новый глобальный раунд успешно запущен!');
        } catch (error) {
            console.error('Ошибка запуска глобального раунда:', error);
            await ctx.reply('Произошла ошибка при запуске глобального раунда');
        }
    }
});

bot.action('join_global', async (ctx) => {
    await commands.startGlobalRating(ctx);
});

bot.action('view_global_profiles', async (ctx) => {
    try {
        const profiles = await db.getGlobalRatingParticipants(ctx.from.id);
        const currentProfile = profiles[0];

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

        const alreadyVoted = await db.checkIfVoted(voterId, targetId);
        if (alreadyVoted) {
            await ctx.answerCbQuery('Вы уже голосовали за эту анкету');
            return;
        }

        await db.saveGlobalVote(voterId, targetId);
        await ctx.answerCbQuery('Ваш голос учтен!');
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

bot.action('vote_profile', async (ctx) => {
    const targetId = ctx.wizard.state.currentProfile.user_id;
    await db.saveGlobalVote(ctx.from.id, targetId);
    await ctx.answerCbQuery('Ваш голос учтен!');
    await showNextGlobalProfile(ctx);
});

bot.action(/^final_vote_(\d+)_(\d+)$/, async (ctx) => {
    try {
        const [, targetId, rating] = ctx.match.map(Number);
        await db.saveFinalVote(targetId, ctx.from.id, rating);
        await ctx.answerCbQuery('Ваш голос учтен!');
    } catch (error) {
        console.error('Ошибка при сохранении финального голоса:', error);
        await ctx.answerCbQuery('Произошла ошибка при сохранении голоса');
    }
});

// Улучшаем обработчик my_chat_member
bot.on('my_chat_member', async (ctx) => {
    try {
        if (!ctx.update?.my_chat_member) return;
        
        const userId = ctx.update.my_chat_member.from.id;
        const newStatus = ctx.update.my_chat_member.new_chat_member.status;
        
        if (newStatus === 'kicked') {
            await db.updateUserStatus(userId, false);
            console.log(`Пользователь ${userId} заблокировал бота`);
        } else if (newStatus === 'member') {
            await db.updateUserStatus(userId, true);
            console.log(`Пользователь ${userId} разблокировал бота`);
            
            try {
                const user = await db.getUserProfile(userId);
                if (user) {
                    await ctx.telegram.sendMessage(
                        userId, 
                        'С возвращением! Рады видеть вас снова.',
                        mainMenu
                    ).catch(() => {});
                }
            } catch (error) {
                console.error(`Ошибка при обработке разблокировки для пользователя ${userId}:`, error);
            }
        }
    } catch (error) {
        console.error('Ошибка при обработке my_chat_member:', error);
    }
});

// Обработчик для кнопки "Начать"
bot.action('start', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await commands.startCommand(ctx);
    } catch (error) {
        console.error('Ошибка при обработке кнопки start:', error);
    }
});

const safeSendMessage = async (bot, userId, message, extra = {}) => {
    try {
        await bot.telegram.sendMessage(userId, message, extra);
        return true;
    } catch (error) {
        if (error.description?.includes('bot was blocked') || 
            error.message?.includes('bot was blocked') ||
            error.code === 403) {
            await db.updateUserStatus(userId, false);
            console.log(`Не удалось отправить сообщение пользователю ${userId} (бот заблокирован)`);
        } else {
            console.error(`Ошибка отправки сообщения пользователю ${userId}:`, error);
        }
        return false;
    }
};

module.exports = {
    bot,
    startBot
};