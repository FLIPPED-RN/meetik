const { mainMenu } = require('../utils/keyboards');
const { formatDate } = require('../utils/helpers');
const db = require('../database');
const commands = require('./index');

async function sendProfileForRating(ctx, profile) {
    try {
        const photos = await db.getUserPhotos(profile.user_id);
        const profileText = `👤 *Анкета для оценки:*
📝 Имя: ${profile.name}
🎂 Возраст: ${profile.age}
🌆 Город: ${profile.city}
${profile.description ? `\n📄 О себе: ${profile.description}` : ''}`;

        const ratingKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '1️⃣', callback_data: `rate_${profile.user_id}_1` },
                        { text: '2️⃣', callback_data: `rate_${profile.user_id}_2` },
                        { text: '3️⃣', callback_data: `rate_${profile.user_id}_3` },
                        { text: '4️⃣', callback_data: `rate_${profile.user_id}_4` },
                        { text: '5️⃣', callback_data: `rate_${profile.user_id}_5` }
                    ],
                    [
                        { text: '6️⃣', callback_data: `rate_${profile.user_id}_6` },
                        { text: '7️⃣', callback_data: `rate_${profile.user_id}_7` },
                        { text: '8️⃣', callback_data: `rate_${profile.user_id}_8` },
                        { text: '9️⃣', callback_data: `rate_${profile.user_id}_9` },
                        { text: '🔟', callback_data: `rate_${profile.user_id}_10` }
                    ]
                ]
            }
        };

        const isGlobalParticipant = await db.isUserInGlobalRating(ctx.from.id);
        if (isGlobalParticipant) {
            await ctx.reply('Вы не можете оценивать анкеты во время глобальной оценки.');
            return;
        }

        if (photos.length > 0) {
            const mediaGroup = photos.map((photoId, index) => ({
                type: 'photo',
                media: photoId,
                ...(index === 0 && { caption: profileText, parse_mode: 'Markdown' })
            }));
            await ctx.replyWithMediaGroup(mediaGroup);
            await ctx.reply('Оцените анкету от 1 до 10:', ratingKeyboard);
        } else {
            await ctx.reply(profileText, {
                parse_mode: 'Markdown',
                ...ratingKeyboard
            });
        }
    } catch (error) {
        console.error('Ошибка при отправке анкеты:', error);
        await ctx.reply('Произошла ошибка при загрузке анкеты.');
    }
}

exports.startCommand = async (ctx) => {
    const user = await db.getUserProfile(ctx.from.id);
    if (!user) {
        const username = ctx.from.username || null;
        await ctx.scene.enter('registration', { username });
    } else {
        await ctx.reply('Добро пожаловать в главное меню!', mainMenu);
    }
};

exports.profileCommand = async (ctx) => {
    try {
        const user = await db.getUserProfile(ctx.from.id);
        const photos = await db.getUserPhotos(ctx.from.id);
        
        if (!user) {
            return ctx.reply('Профиль не найден. Используйте /start для регистрации.');
        }

        const profileText = `👤 *Ваш профиль:*
📝 Имя: ${user.name}
🎂 Возраст: ${user.age}
🌆 Город: ${user.city}
👥 Пол: ${user.gender === 'male' ? 'Мужской' : 'Женский'}
${user.description ? `\n📄 О себе: ${user.description}` : ''}`;

        const editButton = {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✏️ Редактировать профиль', callback_data: 'edit_profile' }
                ]]
            }
        };

        if (photos.length > 0) {
            const mediaGroup = photos.map((photoId, index) => ({
                type: 'photo',
                media: photoId,
                ...(index === 0 && { caption: profileText, parse_mode: 'Markdown' })
            }));
            await ctx.replyWithMediaGroup(mediaGroup);
            await ctx.reply('Управление профилем:', editButton);
        } else {
            await ctx.reply(profileText, {
                parse_mode: 'Markdown',
                ...editButton
            });
        }
    } catch (error) {
        console.error('Ошибка при получении профиля:', error);
        await ctx.reply('Произошла ошибка при загрузке профиля.');
    }
};

exports.startRatingCommand = async (ctx) => {
    try {
        const profiles = await db.getProfilesForRating(ctx.from.id);
        
        if (!profiles || profiles.length === 0) {
            return ctx.reply('Сейчас нет доступных анкет для оценки. Попробуйте позже.');
        }

        await sendProfileForRating(ctx, profiles[0]);
    } catch (error) {
        console.error('Ошибка при получении анкет:', error);
        await ctx.reply('Произошла ошибка при загрузке анкет.');
    }
};

exports.leadersCommand = async (ctx) => {
    try {
        const winners = await db.getCurrentRoundWinners();
        if (!winners || winners.length === 0) {
            return ctx.reply('Пока нет лидеров в текущем раунде.');
        }

        let leaderboardText = '🏆 *Текущие лидеры:*\n\n';
        winners.forEach((winner, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
            leaderboardText += `${medal} ${winner.name}\n` +
                             `⭐️ Рейтинг: ${Number(winner.average_rating).toFixed(2)}\n` +
                             `💰 Монет: ${winner.coins || 0}\n` +
                             `${winner.coins_received ? `💵 Получено за место: ${winner.coins_received}\n` : ''}` +
                             `\n`;
        });

        await ctx.reply(leaderboardText, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка при получении лидеров:', error);
        await ctx.reply('Произошла ошибка при загрузке списка лидеров.');
    }
};

exports.whoRatedMeCommand = (bot) => async (ctx) => {
    try {
        const ratings = await db.getLastRatings(ctx.from.id);
        
        if (!ratings || ratings.length === 0) {
            return ctx.reply('Пока никто не оценил ваш профиль.');
        }

        let profiles = [];

        for (const rating of ratings) {
            const raterProfile = await db.getUserProfile(rating.from_user_id);
            if (raterProfile) {
                profiles.push({
                    name: raterProfile.name,
                    age: raterProfile.age,
                    city: raterProfile.city,
                    rating: rating.rating,
                    userId: raterProfile.user_id,
                    username: raterProfile.username,
                    photos: await db.getUserPhotos(raterProfile.user_id)
                });
            }
        }

        let currentIndex = 0;
        const totalProfiles = profiles.length;

        const escapeMarkdownV2 = (text) => {
            return text.replace(/([_.*[\]()~`>#+\-=|{}.!])/g, '\\$1');
        };

        const sendProfile = () => {
            const profile = profiles[currentIndex];
            const profileMessage = `👤 *${escapeMarkdownV2(profile.name)}*, ${profile.age} лет\n` +
                                   `🌆 ${escapeMarkdownV2(profile.city)}\n` +
                                   `⭐️ Оценка: ${profile.rating}/10\n` +
                                   `${profile.username ? `📱 Профиль @${escapeMarkdownV2(profile.username)}\n` : ''}`;

            const replyMarkup = {
                inline_keyboard: [
                    [
                        { text: '⬅️ Назад', callback_data: 'prev_profile' },
                        { text: '➡️ Вперед', callback_data: 'next_profile' }
                    ]
                ]
            };

            if (profile.photos && profile.photos.length > 0) {
                ctx.replyWithPhoto(profile.photos[0], {
                    caption: profileMessage,
                    parse_mode: 'MarkdownV2',
                    reply_markup: replyMarkup
                });
            } else {
                ctx.reply(profileMessage, {
                    parse_mode: 'MarkdownV2',
                    reply_markup: replyMarkup
                });
            }
        };

        sendProfile();

        bot.action('prev_profile', async (ctx) => {
            if (currentIndex > 0) {
                currentIndex--;
                sendProfile();
            } else {
                await ctx.answerCbQuery('Это первый профиль.');
            }
        });

        bot.action('next_profile', async (ctx) => {
            if (currentIndex < totalProfiles - 1) {
                currentIndex++;
                sendProfile();
            } else {
                await ctx.answerCbQuery('Это последний профиль.');
            }
        });

    } catch (error) {
        console.error('Ошибка при получении оценок:', error);
        await ctx.reply('Произошла ошибка при загрузке оценок.');
    }
};

exports.globalRatingCommand = async (ctx) => {
    try {
        const user = await db.getUserProfile(ctx.from.id);
        const currentRound = await db.getCurrentGlobalRound();

        // Проверяем, не заблокирован ли пользователь после победы
        const isBlocked = user.last_global_win && 
            (new Date(user.last_global_win).getTime() + 2 * 60 * 60 * 1000 > Date.now());
        
        const minutesLeft = isBlocked ? 
            Math.ceil((new Date(user.last_global_win).getTime() + 2 * 60 * 60 * 1000 - Date.now()) / 60000) : 0;

        let message = `🌍 *Глобальная оценка*\n\n`;
        message += `💰 Стоимость участия: 50 монет\n`;
        message += `💵 Ваш баланс: ${user.coins} монет\n\n`;
        message += `🏆 Призы:\n`;
        message += `1 место: 500 монет\n`;
        message += `2 место: 300 монет\n`;
        message += `3 место: 100 монет\n`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: []
            }
        };

        if (currentRound && user.in_global_rating) {
            const timeLeft = Math.ceil(currentRound.minutes_left);
            message += `\n⏰ До конца раунда: ${timeLeft} минут`;
            message += `\n\n⏳ Ожидайте окончания раунда...`;
        } else if (!currentRound) {
            if (isBlocked) {
                message += `\n\n⚠️ Вы недавно победили в глобальной оценке!\n`;
                message += `⏳ Подождите ещё ${minutesLeft} минут для участия.`;
            } else if (user.coins >= 50) {
                message += '\n\nНажмите кнопку ниже, чтобы начать новый раунд!';
                keyboard.reply_markup.inline_keyboard.push([
                    { text: '🎯 Участвовать за 50 монет', callback_data: 'join_global' }
                ]);
            } else {
                message += '\n\n❌ У вас недостаточно монет для участия';
            }
        }

        await ctx.reply(message, {
            parse_mode: 'Markdown',
            ...keyboard
        });
    } catch (error) {
        console.error('Ошибка глобальной оценки:', error);
        await ctx.reply('Произошла ошибка при загрузке глобальной оценки.');
    }
};

exports.balanceCommand = async (ctx) => {
    try {
        const user = await db.getUserProfile(ctx.from.id);
        if (!user) {
            return ctx.reply('Профиль не найден. Используйте /start для регистрации.');
        }

        const balanceText = `💰 *Ваш баланс: ${user.coins} монет*`;
        await ctx.reply(balanceText, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка при получении баланса:', error);
        await ctx.reply('Произошла ошибка при загрузке баланса.');
    }
};

async function announceGlobalRatingStart(ctx) {
    const users = await db.getAllUsers();
    const message = `🌟 *Внимание! Начался новый раунд глобальной оценки!*\n\n` +
                    `🎯 Участвуйте в оценке одной из 10 анкет!`;

    for (const user of users) {
        try {
            await ctx.telegram.sendMessage(user.user_id, message, {
                parse_mode: 'Markdown'
            });
        } catch (error) {
            console.error(`Ошибка отправки уведомления пользователю ${user.user_id}:`, error);
        }
    }
}

async function startGlobalRating(ctx) {
    const user = await db.getUserProfile(ctx.from.id);
    const participantsCount = await db.getGlobalRatingParticipantsCount();

    const isBlocked = user.last_global_win && 
        (new Date(user.last_global_win).getTime() + 2 * 60 * 60 * 1000 > Date.now());

    if (isBlocked) {
        const minutesLeft = Math.ceil((new Date(user.last_global_win).getTime() + 2 * 60 * 60 * 1000 - Date.now()) / 60000);
        return ctx.reply(`Вы недавно победили в глобальной оценке! Подождите ещё ${minutesLeft} минут для участия.`);
    }

    await db.joinGlobalRating(ctx.from.id);
    await ctx.answerCbQuery('Вы успешно присоединились к глобальной оценке!');

    const updatedParticipantsCount = await db.getGlobalRatingParticipantsCount();
    if (updatedParticipantsCount === 10) {
    }
}

async function finishGlobalRound() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            UPDATE global_rounds 
            SET is_active = false 
            WHERE is_active = true
        `);

        const topParticipants = await client.query(`
            SELECT u.*, COUNT(gv.voter_id) as votes_count
            FROM users u
            LEFT JOIN global_votes gv ON gv.candidate_id = u.user_id
            WHERE u.in_global_rating = true
            GROUP BY u.user_id
            ORDER BY votes_count DESC, RANDOM()
            LIMIT 10
        `);

        for (let i = 0; i < topParticipants.rows.length; i++) {
            const participant = topParticipants.rows[i];
            const coins = i === 0 ? 500 : i === 1 ? 300 : i === 2 ? 100 : 0;

            if (coins > 0) {
                await client.query(`
                    UPDATE users 
                    SET coins = coins + $1,
                        last_global_win = CASE 
                            WHEN $2 <= 2 THEN NOW() 
                            ELSE last_global_win 
                        END
                    WHERE user_id = $3
                `, [coins, i, participant.user_id]);
            }
        }

        await client.query(`UPDATE users SET in_global_rating = false WHERE in_global_rating = true`);
        await client.query(`DELETE FROM global_votes`);

        await client.query('COMMIT');
        return topParticipants.rows;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

exports.startGlobalRating = startGlobalRating;

exports.viewProfileCommand = async (ctx) => {
    const userId = ctx.callbackQuery.data.split('_')[2];
    const profile = await db.getUserProfile(userId);
    
    if (profile) {
        const profileText = `👤 *Профиль:*\n📝 Имя: ${profile.name}\n🎂 Возраст: ${profile.age}\n🌆 Город: ${profile.city}\n${profile.description ? `📄 О себе: ${profile.description}` : ''}`;
        
        const photos = await db.getUserPhotos(userId);
        if (photos.length > 0) {
            const mediaGroup = photos.map((photoId, index) => ({
                type: 'photo',
                media: photoId,
                ...(index === 0 && { caption: profileText, parse_mode: 'Markdown' })
            }));
            await ctx.replyWithMediaGroup(mediaGroup);
        } else {
            await ctx.reply(profileText, { parse_mode: 'Markdown' });
        }
    } else {
        await ctx.reply('Профиль не найден.');
    }
};

exports.registerBotActions = (bot) => {
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

            // Если оценка от 7 до 10, показываем профиль
            if (rating >= 7) {
                await ctx.reply(`Вас высоко оценили! Вот ваш профиль:`);
                await sendProfileForRating(ctx, result.targetProfile); // Показываем профиль
            } else {
                const nextProfile = await db.getNextProfile(ctx.from.id);
                if (nextProfile) {
                    await sendProfileForRating(ctx, nextProfile);
                } else {
                    await ctx.reply('На сегодня анкеты закончились. Приходите позже!', mainMenu);
                }
            }
        } catch (error) {
            console.error('Ошибка при сохранении оценки:', error);
            await ctx.answerCbQuery('Произошла ошибка при сохранении оценки');
        }
    });
};