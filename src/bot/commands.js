const { mainMenu, ratingKeyboard, profileNavigationKeyboard, editProfileButton } = require('../utils/keyboards');
const { formatDate } = require('../utils/helpers');
const { viewProfileButton } = require('../utils/keyboards');
const db = require('../database');
const commands = require('./index');

async function sendProfileForRating(ctx, profile) {
    try {
        const photos = await db.getUserPhotos(profile.user_id);
        const isGlobalParticipant = await db.isUserInGlobalRating(profile.user_id);
        
        const profileText = `👤 *Анкета для оценки:*
📝 Имя: ${profile.name}
🎂 Возраст: ${profile.age}
🌆 Город: ${profile.city}
${profile.description ? `\n📄 О себе: ${profile.description}` : ''}
${isGlobalParticipant ? '\n🌍 *Участвует в глобальном рейтинге*' : ''}`;

        if (photos.length > 0) {
            const mediaGroup = photos.map((photoId, index) => ({
                type: 'photo',
                media: photoId,
                ...(index === 0 && { caption: profileText, parse_mode: 'Markdown' })
            }));
            await ctx.replyWithMediaGroup(mediaGroup);
            await ctx.reply('Оцените анкету от 1 до 10:', ratingKeyboard(profile.user_id));
        } else {
            await ctx.reply(profileText, {
                parse_mode: 'Markdown',
                ...ratingKeyboard(profile.user_id)
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
            ...editProfileButton
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

        const uniqueRatings = ratings.filter((rating, index, self) =>
            index === self.findIndex((r) => r.from_user_id === rating.from_user_id)
        ).slice(0, 10);

        const showRating = async (ctx, index) => {
            try {
                const rating = uniqueRatings[index];
                const raterProfile = await db.getUserProfile(rating.from_user_id);
                const photos = await db.getUserPhotos(rating.from_user_id);

                const escapedUsername = raterProfile.username ? 
                    raterProfile.username.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1') : '';

                const keyboard = {
                    inline_keyboard: profileNavigationKeyboard(index, uniqueRatings.length).inline_keyboard
                };

                const caption = `👤 *${raterProfile.name}*, ${raterProfile.age} лет\n` +
                              `🌆 ${raterProfile.city}\n` +
                              `⭐️ Оценка: ${rating.rating}/10\n` +
                              `${raterProfile.username ? `📱 @${escapedUsername}\n` : ''}`;

                if (ctx.callbackQuery) {
                    if (photos.length > 0) {
                        await ctx.editMessageMedia({
                            type: 'photo',
                            media: photos[0],
                            caption: caption,
                            parse_mode: 'Markdown'
                        }, { reply_markup: keyboard });
                    } else {
                        await ctx.editMessageText(caption, {
                            parse_mode: 'Markdown',
                            reply_markup: keyboard
                        });
                    }
                } else {
                    if (photos.length > 0) {
                        await ctx.replyWithPhoto(photos[0], {
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
            } catch (error) {
                if (!error.message.includes('message is not modified')) {
                    console.error('Ошибка при показе рейтинга:', error);
                    await ctx.reply('Произошла ошибка при показе рейтинга.');
                }
            }
        };

        // Показываем первую оценку
        await showRating(ctx, 0);

        // Обработчики кнопок навигации
        bot.action(/rating_prev_(\d+)/, async (ctx) => {
            const index = parseInt(ctx.match[1]);
            const newIndex = index > 0 ? index - 1 : uniqueRatings.length - 1;
            await ctx.answerCbQuery();
            await showRating(ctx, newIndex);
        });

        bot.action(/rating_next_(\d+)/, async (ctx) => {
            const index = parseInt(ctx.match[1]);
            const newIndex = index < uniqueRatings.length - 1 ? index + 1 : 0;
            await ctx.answerCbQuery();
            await showRating(ctx, newIndex);
        });

        bot.action('rating_count', async (ctx) => {
            await ctx.answerCbQuery();
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

        // Если идет финальное голосование, блокируем доступ
        if (currentRound?.is_final_voting) {
            return ctx.reply('🔒 Сейчас идет финальное голосование. Подождите его окончания.');
        }

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
            // Проверяем, не истекло ли время раунда
            const now = new Date();
            const endTime = new Date(currentRound.rating_end_time);
            
            if (now > endTime) {
                // Если время истекло, завершаем раунд
                await db.finishGlobalRound();
                message += `\n\n🏁 Раунд завершен! Результаты будут объявлены в ближайшее время.`;
            } else {
                const timeLeft = Math.ceil((endTime.getTime() - now.getTime()) / 60000);
                message += `\n⏰ До конца раунда: ${timeLeft} минут`;
                message += `\n\n⏳ Ваша анкета участвует в оценке...`;
            }
        } else if (!currentRound) {
            if (isBlocked) {
                message += `\n\n⚠️ Вы недавно участвовали в глобальной оценке!\n`;
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

    if (user.coins < 50) {
        return ctx.reply('Недостаточно монет для участия!');
    }

    try {
        await db.joinGlobalRating(ctx.from.id);
        await ctx.answerCbQuery('Вы успешно присоединились к глобальной оценке!');
        await ctx.reply('Ваша анкета участвует в глобальной оценке! Дождитесь окончания раунда (25 минут).');
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

            const isTargetInGlobalRating = await db.isUserInGlobalRating(targetId);

            if (isTargetInGlobalRating) {
                // Сохраняем оценку в таблицу global_ratings
                await db.saveGlobalRating(targetId, ctx.from.id, rating);
                await ctx.answerCbQuery('Оценка в глобальном рейтинге сохранена!');
            } else {
                // Сохраняем обычную оценку и начисляем монеты
                await db.saveRating(targetId, ctx.from.id, rating);
                await ctx.answerCbQuery('Оценка сохранена!');

                // Начисляем монеты только для обычных оценок
                if (rating >= 7) {
                    const raterProfile = await db.getUserProfile(ctx.from.id);
                    const raterPhotos = await db.getUserPhotos(ctx.from.id);
                    
                    const notificationText = `🌟 Вас высоко оценили!\n\n` +
                                         `⭐️ Оценка: ${rating}/10\n\n` +
                                         `👤 Профиль того, кто вас оценил:\n` +
                                         `📝 Имя: ${raterProfile.name}\n` +
                                         `🎂 Возраст: ${raterProfile.age}\n` +
                                         `🌆 Город: ${raterProfile.city}\n` +
                                         `${raterProfile.username ? `📱 @${raterProfile.username}\n` : ''}` +
                                         `${raterProfile.description ? `\n📄 О себе: ${raterProfile.description}` : ''}`;

                    if (raterPhotos.length > 0) {
                        const mediaGroup = raterPhotos.map((photoId, index) => ({
                            type: 'photo',
                            media: photoId,
                            ...(index === 0 && { caption: notificationText })
                        }));
                        await ctx.telegram.sendMediaGroup(targetId, mediaGroup);
                    } else {
                        await ctx.telegram.sendMessage(targetId, notificationText, { 
                            parse_mode: 'Markdown'
                        });
                    }
                }
            }

            const nextProfile = await db.getNextProfile(ctx.from.id);
            if (!nextProfile) {
                await ctx.reply('На данный момент доступных анкет больше нет. Попробуйте позже! 😊', mainMenu);
                return;
            }

            await sendProfileForRating(ctx, nextProfile);

        } catch (error) {
            console.error('Ошибка при сохранении оценки:', error);
            await ctx.answerCbQuery('Произошла ошибка при сохранении оценки');
        }
    });

    bot.action(/^final_select_(\d+)$/, async (ctx) => {
        try {
            const candidateId = parseInt(ctx.match[1]);
            const voterId = ctx.from.id;

            // Проверяем, активен ли сейчас финальный раунд
            const currentRound = await db.getCurrentGlobalRound();
            if (!currentRound?.is_final_voting) {
                await ctx.answerCbQuery('Финальное голосование уже завершено!');
                return;
            }

            // Проверяем, не голосовал ли уже пользователь
            const hasVoted = await db.checkFinalVote(voterId);
            if (hasVoted) {
                await ctx.answerCbQuery('Вы уже сделали свой выбор!');
                return;
            }

            // Сохраняем голос
            await db.saveFinalVote(candidateId, voterId);
            await ctx.answerCbQuery('Ваш голос учтен!');
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch (error) {
            console.error('Ошибка при сохранении финального голоса:', error);
            await ctx.answerCbQuery('Произошла ошибка при сохранении голоса');
        }
    });

    // Навигация по финальным профилям
    bot.action(/^final_(prev|next)_(\d+)$/, async (ctx) => {
        try {
            const [, direction, currentId] = ctx.match;
            const profiles = await db.getTopProfiles();
            const currentIndex = profiles.findIndex(p => p.user_id === parseInt(currentId));
            
            let newIndex;
            if (direction === 'prev') {
                newIndex = currentIndex > 0 ? currentIndex - 1 : profiles.length - 1;
            } else {
                newIndex = currentIndex < profiles.length - 1 ? currentIndex + 1 : 0;
            }

            await sendFinalVotingProfile(ctx.telegram, ctx.from.id, profiles[newIndex]);
            await ctx.deleteMessage();
        } catch (error) {
            console.error('Ошибка при навигации:', error);
            await ctx.answerCbQuery('Произошла ошибка');
        }
    });
};

async function startFinalVoting(bot) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Получаем топ-10 участников
        const topProfiles = await client.query(`
            SELECT u.*, SUM(gv.rating) as total_rating
            FROM users u
            LEFT JOIN global_votes gv ON gv.candidate_id = u.user_id
            WHERE u.in_global_rating = true
            GROUP BY u.user_id
            ORDER BY total_rating DESC
            LIMIT 10
        `);

        // Обновляем статус раунда
        await client.query(`
            UPDATE global_rounds 
            SET is_final_voting = true 
            WHERE is_active = true
        `);

        // Удаляем статус участия у тех, кто не попал в топ-10
        await client.query(`
            UPDATE users 
            SET in_global_rating = false 
            WHERE user_id NOT IN (
                SELECT user_id FROM (${topProfiles.text}) top_10
            )
        `);

        // Отправляем анкеты всем пользователям
        const users = await client.query('SELECT user_id FROM users WHERE in_global_rating = false');
        
        for (const user of users.rows) {
            for (const profile of topProfiles.rows) {
                try {
                    await sendFinalVotingProfile(bot, user.user_id, profile);
                    await new Promise(resolve => setTimeout(resolve, 100)); // Задержка
                } catch (error) {
                    console.error(`Ошибка отправки анкеты пользователю ${user.user_id}:`, error);
                }
            }
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function sendFinalVotingProfile(bot, userId, profile) {
    try {
        const photos = await db.getUserPhotos(profile.user_id);
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '⬅️', callback_data: `final_prev_${profile.user_id}` },
                    { text: '❤️ Выбрать', callback_data: `final_select_${profile.user_id}` },
                    { text: '➡️', callback_data: `final_next_${profile.user_id}` }
                ]
            ]
        };

        const caption = `👤 *${profile.name}*, ${profile.age} лет\n` +
                       `🌆 ${profile.city}\n` +
                       `${profile.description ? `📝 ${profile.description}\n` : ''}` +
                       `\n💫 Набрано голосов: ${profile.total_votes}`;

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
    } catch (error) {
        console.error('Ошибка при отправке профиля для финального голосования:', error);
    }
}

async function broadcastWinners(bot, winners) {
    const users = await db.getAllUsers();
    
    for (const user of users) {
        try {
            const message = `🏆 Завершился глобальный раунд!\n\nТоп-3 победителя:`;
            await bot.telegram.sendMessage(user.user_id, message);
            
            // Отправляем первого победителя с кнопками навигации
            await sendWinnerProfile(bot, user.user_id, winners[0], 0, winners.length);
        } catch (error) {
            console.error(`Ошибка отправки победителей пользователю ${user.user_id}:`, error);
        }
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
                { text: `${currentIndex + 1}/3`, callback_data: 'winners_count' },
                { text: '➡️', callback_data: `winners_next_${currentIndex}` }
            ]
        ]
    };

    const photos = await db.getUserPhotos(winner.user_id);
    const caption = `${medals[currentIndex]} *${place} место*\n\n` +
                   `👤 *${winner.name}*, ${winner.age} лет\n` +
                   `🌆 ${winner.city}\n` +
                   `${winner.description ? `📝 ${winner.description}\n` : ''}` +
                   `\n💫 Набрано голосов: ${winner.votes_count}\n` +
                   `💰 Получено монет: ${prizes[currentIndex]}`;

    try {
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
    } catch (error) {
        console.error('Ошибка отправки профиля победителя:', error);
    }
}