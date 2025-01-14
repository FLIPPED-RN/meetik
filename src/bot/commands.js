const { mainMenu } = require('../utils/keyboards');
const { formatDate } = require('../utils/helpers');
const { viewProfileButton } = require('../utils/keyboards');
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

        const viewProfileButton = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '👤 Посмотреть профиль', callback_data: `view_profile_${profile.user_id}` }
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

        const mediaGroup = photos.map((photoId, index) => ({
            type: 'photo',
            media: photoId,
            ...(index === 0 && { caption: profileText, parse_mode: 'Markdown' })
        }));

        const replyOptions = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✏️ Редактировать профиль', callback_data: 'edit_profile' }
                    ]
                ]
            }
        };

        if (photos.length > 0) {
            await ctx.replyWithMediaGroup(mediaGroup);
            await ctx.reply('Управление профилем:', replyOptions);
        } else {
            await ctx.reply(profileText, {
                parse_mode: 'Markdown',
                ...replyOptions
            });
        }
    } catch (error) {
        console.error('Ошибка при получении профиля:', error);
        await ctx.reply('Произошла ошибка при загрузке профиля.');
    }
};

exports.startRatingCommand = async (ctx) => {
    try {
        const userInGlobal = await db.isUserInGlobalRating(ctx.from.id);
        if (userInGlobal) {
            return ctx.reply('Вы не можете оценивать анкеты, пока участвуете в глобальной оценке.');
        }

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

        const uniqueUserIds = new Set(); // Используем Set для уникальности
        let currentIndex = 0; // Индекс текущей анкеты

        const showNextRating = async () => {
            if (currentIndex >= ratings.length) {
                return ctx.reply('На сегодня анкеты закончились.');
            }

            const rating = ratings[currentIndex];
            if (!uniqueUserIds.has(rating.from_user_id)) { // Проверяем уникальность
                uniqueUserIds.add(rating.from_user_id);
                const raterProfile = await db.getUserProfile(rating.from_user_id);
                if (raterProfile) {
                    const photos = await db.getUserPhotos(raterProfile.user_id);
                    if (photos.length > 0) {
                        const mediaGroup = photos.map((photoId, index) => ({
                            type: 'photo',
                            media: photoId,
                            ...(index === 0 && { caption: `👤 *${raterProfile.name.replace(/([_*[\]()~`>#+\-.!])/g, '\\$1')}*, ${raterProfile.age} лет\n🌆 ${raterProfile.city}\n⭐️ Оценка: ${rating.rating}/10\n${raterProfile.username ? `📱 Профиль @${raterProfile.username.replace(/([_*[\]()~`>#+\-.!])/g, '\\$1')}\n` : ''}`, parse_mode: 'MarkdownV2' })
                        }));
                        await ctx.replyWithMediaGroup(mediaGroup);
                    } else {
                        await ctx.reply(`👤 *${raterProfile.name}*, ${raterProfile.age} лет\n🌆 ${raterProfile.city}\n⭐️ Оценка: ${rating.rating}/10\n${raterProfile.username ? `📱 Профиль @${raterProfile.username}\n` : ''}`, {
                            parse_mode: 'MarkdownV2',
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: 'Показать еще', callback_data: 'show_next_rating' }
                                ]]
                            }
                        });
                    }
                    currentIndex++; // Увеличиваем индекс для следующей анкеты
                }
            } else {
                currentIndex++; // Пропускаем, если уже показывали
                await showNextRating(); // Рекурсивно показываем следующую анкету
            }
        };

        await showNextRating(); // Начинаем показывать анкеты

        bot.action('show_next_rating', async (ctx) => {
            await ctx.answerCbQuery(); // Подтверждаем нажатие кнопки
            await showNextRating(); // Показываем следующую анкету
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

        // Проверяем блокировку после победы
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
            const timeLeft = Math.ceil((new Date(currentRound.rating_end_time).getTime() - Date.now()) / 60000);
            message += `\n⏰ До конца раунда: ${timeLeft} минут`;
            message += `\n\n⏳ Ваша анкета участвует в оценке...`;
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

async function startGlobalRating(ctx) {
    const user = await db.getUserProfile(ctx.from.id);

    const isBlocked = user.last_global_win && 
        (new Date(user.last_global_win).getTime() + 2 * 60 * 60 * 1000 > Date.now());

    if (isBlocked) {
        const minutesLeft = Math.ceil((new Date(user.last_global_win).getTime() + 2 * 60 * 60 * 1000 - Date.now()) / 60000);
        return ctx.reply(`Вы недавно победили в глобальной оценке! Подождите ещё ${minutesLeft} минут для участия.`);
    }

    if (user.coins < 50) {
        return ctx.reply('Недостаточно монет для участия!');
    }

    try {
        await db.joinGlobalRating(ctx.from.id);
        await ctx.answerCbQuery('Вы успешно присоединились к глобальной оценке!');
        await ctx.reply('Ваша анкета участвует в глобальной оценке! Дождитесь окончания раунда.');
    } catch (error) {
        console.error('Ошибка при присоединении к глобальной оценке:', error);
        await ctx.reply('Произошла ошибка при присоединении к глобальной оценке.');
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
            
            const existingRating = await db.getRating(targetId, ctx.from.id);
            if (existingRating) {
                await ctx.answerCbQuery('Вы уже оценили эту анкету!');
                return;
            }

            await db.saveRating(targetId, ctx.from.id, rating);
            await ctx.answerCbQuery('Оценка сохранена!');

            // Получаем следующую анкету
            const nextProfile = await db.getNextProfile(ctx.from.id);
            if (!nextProfile) {
                await ctx.reply('На данный момент доступных анкет больше нет. Попробуйте позже! 😊', mainMenu);
                return;
            }

            // Если поставили высокую оценку (7-10), отправляем свою анкету
            if (rating >= 7) {
                const myProfile = await db.getUserProfile(ctx.from.id);
                const photos = await db.getUserPhotos(ctx.from.id);
                
                // Экранируем специальные символы для Markdown
                const escapedName = myProfile.name.replace(/([_*[\]()~`>#+\-.!])/g, '\\$1');
                const escapedCity = myProfile.city.replace(/([_*[\]()~`>#+\-.!])/g, '\\$1');
                const escapedDescription = myProfile.description ? 
                    myProfile.description.replace(/([_*[\]()~`>#+\-.!])/g, '\\$1') : '';
                const escapedUsername = ctx.from.username ? 
                    ctx.from.username.replace(/([_*[\]()~`>#+\-.!])/g, '\\$1') : 'отсутствует';

                const profileText = `�� Вас высоко оценили!\n\n` +
                                  `👤 Профиль того, кто вас оценил:\n` +
                                  `📝 Имя: ${escapedName}\n` +
                                  `🎂 Возраст: ${myProfile.age}\n` +
                                  `🌆 Город: ${escapedCity}\n` +
                                  `${escapedDescription ? `\n📄 О себе: ${escapedDescription}` : ''}\n\n` +
                                  `📱 Telegram: @${escapedUsername}`;

                if (photos.length > 0) {
                    const mediaGroup = photos.map((photoId, index) => ({
                        type: 'photo',
                        media: photoId,
                        ...(index === 0 && { 
                            caption: `�� Вас высоко оценили!\n\n` +
                                    `👤 Профиль того, кто вас оценил:\n` +
                                    `📝 Имя: ${escapedName}\n` +
                                    `🎂 Возраст: ${myProfile.age}\n` +
                                    `🌆 Город: ${escapedCity}\n` +
                                    `${escapedDescription ? `\n📄 О себе: ${escapedDescription}` : ''}\n\n` +
                                    `📱 Telegram: @${escapedUsername}`,
                            parse_mode: 'Markdown'
                        })
                    }));
                    await ctx.telegram.sendMediaGroup(targetId, mediaGroup);
                } else {
                    await ctx.telegram.sendMessage(targetId, profileText, { parse_mode: 'Markdown' });
                }
            }

            // Если меня кто-то оценил высоко, показываем его анкету
            const highRatingsForMe = await db.getHighRatingsForUser(ctx.from.id);
            if (highRatingsForMe.length > 0) {
                for (const rating of highRatingsForMe) {
                    const raterProfile = await db.getUserProfile(rating.from_user_id);
                    const raterPhotos = await db.getUserPhotos(rating.from_user_id);

                    const raterProfileText = `🎉 Этот пользователь оценил вас на ${rating.rating}/10!\n\n` +
                                          `👤 *Профиль:*\n` +
                                          `📝 Имя: ${raterProfile.name}\n` +
                                          `🎂 Возраст: ${raterProfile.age}\n` +
                                          `🌆 Город: ${raterProfile.city}\n` +
                                          `${raterProfile.description ? `\n📄 О себе: ${raterProfile.description}` : ''}\n\n` +
                                          `📱 Telegram: @${raterProfile.username || 'отсутствует'}`;

                    if (raterPhotos.length > 0) {
                        const mediaGroup = raterPhotos.map((photoId, index) => ({
                            type: 'photo',
                            media: photoId,
                            ...(index === 0 && { caption: raterProfileText, parse_mode: 'Markdown' })
                        }));
                        await ctx.replyWithMediaGroup(mediaGroup);
                    } else {
                        await ctx.reply(raterProfileText, { parse_mode: 'Markdown' });
                    }
                }
                // Очищаем обработанные оценки
                await db.clearProcessedHighRatings(ctx.from.id);
            }

            // Показываем следующую анкету для оценки
            await sendProfileForRating(ctx, nextProfile);

        } catch (error) {
            console.error('Ошибка при сохранении оценки:', error);
            await ctx.answerCbQuery('Произошла ошибка при сохранении оценки');
        }
    });
};