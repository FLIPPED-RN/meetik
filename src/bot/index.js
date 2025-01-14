const { Telegraf, Scenes, session } = require('telegraf');
const config = require('../config');
const commands = require('./commands');
const middleware = require('./middleware');
const { registrationScene, editProfileScene } = require('../scenes');
const { mainMenu } = require('../utils/keyboards');
const db = require('../database');

const bot = new Telegraf(config.BOT_TOKEN);
const stage = new Scenes.Stage([registrationScene, editProfileScene]);

bot.use(session());
bot.use(stage.middleware());
bot.use(middleware.errorHandler);
bot.use(middleware.userCheck);
bot.use(middleware.rateLimit);

bot.command('start', commands.startCommand);
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
        if (currentRound && new Date(currentRound.rating_end_time) <= new Date()) {
            const topProfiles = await db.getTopProfilesByRatings();
            
            const users = await db.getAllUsers();
            for (const user of users) {
                if (!await db.isUserInGlobalRating(user.user_id)) {
                    for (const profile of topProfiles) {
                        try {
                            await sendProfileForFinalVoting(bot, user.user_id, profile);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } catch (error) {
                            console.error(`Ошибка отправки анкеты пользователю ${user.user_id}:`, error);
                        }
                    }
                }
            }

            setTimeout(async () => {
                const winners = await db.finishGlobalRound();
                for (let i = 0; i < Math.min(3, winners.length); i++) {
                    const winner = winners[i];
                    const coins = i === 0 ? 500 : i === 1 ? 300 : i === 2 ? 100 : 0;
                    try {
                        await bot.telegram.sendMessage(
                            winner.user_id,
                            `🎉 Поздравляем! Вы заняли ${i + 1} место в глобальной оценке и получили ${coins} монет!`
                        );
                    } catch (error) {
                        console.error(`Ошибка отправки уведомления победителю ${winner.user_id}:`, error);
                    }
                }

                await db.createGlobalRound();
            }, 5 * 60 * 1000);
        }
    } catch (error) {
        console.error('Ошибка обновления глобального раунда:', error);
    }
}, 60 * 1000);

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

async function sendProfileForFinalVoting(bot, userId, profile) {
    try {
        const photos = await db.getUserPhotos(profile.user_id);
        const profileText = `👤 *Анкета для финального голосования:*\n` +
                          `📝 Имя: ${profile.name}\n` +
                          `🎂 Возраст: ${profile.age}\n` +
                          `🌆 Город: ${profile.city}\n` +
                          `${profile.description ? `\n📄 О себе: ${profile.description}` : ''}`;

        const ratingKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '1️⃣', callback_data: `final_vote_${profile.user_id}_1` },
                        { text: '2️⃣', callback_data: `final_vote_${profile.user_id}_2` },
                        { text: '3️⃣', callback_data: `final_vote_${profile.user_id}_3` },
                        { text: '4️⃣', callback_data: `final_vote_${profile.user_id}_4` },
                        { text: '5️⃣', callback_data: `final_vote_${profile.user_id}_5` }
                    ],
                    [
                        { text: '6️⃣', callback_data: `final_vote_${profile.user_id}_6` },
                        { text: '7️⃣', callback_data: `final_vote_${profile.user_id}_7` },
                        { text: '8️⃣', callback_data: `final_vote_${profile.user_id}_8` },
                        { text: '9️⃣', callback_data: `final_vote_${profile.user_id}_9` },
                        { text: '🔟', callback_data: `final_vote_${profile.user_id}_10` }
                    ]
                ]
            }
        };

        if (photos.length > 0) {
            const mediaGroup = photos.map((photoId, index) => ({
                type: 'photo',
                media: photoId,
                ...(index === 0 && { caption: profileText, parse_mode: 'Markdown' })
            }));
            await bot.telegram.sendMediaGroup(userId, mediaGroup);
            await bot.telegram.sendMessage(userId, 'Оцените анкету от 1 до 10:', ratingKeyboard);
        } else {
            await bot.telegram.sendMessage(userId, profileText, {
                parse_mode: 'Markdown',
                ...ratingKeyboard
            });
        }
    } catch (error) {
        console.error('Ошибка при отправке анкеты для финального голосования:', error);
    }
}

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

module.exports = {
    bot,
    startBot
};