const { mainMenu, ratingKeyboard, profileNavigationKeyboard, editProfileButton, editProfileKeyboard, editPreferencesKeyboard } = require('../utils/keyboards');
const { formatDate } = require('../utils/helpers');
const { viewProfileButton } = require('../utils/keyboards');
const db = require('../database');
const commands = require('./index');

async function sendProfileForRating(ctx, profile) {
    if (!profile) {
        await ctx.reply('Нет доступных анкет для оценки.');
        return;
    }

    try {
        const photos = await db.getUserPhotos(profile.user_id);
        const isGlobalParticipant = profile.in_global_rating;
        
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
    try {
        // Проверяем подписку на канал
        const chatMember = await ctx.telegram.getChatMember('@meetik_info', ctx.from.id);
        
        if (['creator', 'administrator', 'member'].includes(chatMember.status)) {
            const user = await db.getUserProfile(ctx.from.id);
            
            if (user) {
                await db.updateUserStatus(ctx.from.id, true);
                await ctx.reply('С возвращением в МИТИК! Все необходимое можете найти в главном меню.', mainMenu);
            } else {
                const username = ctx.from.username || null;
                await ctx.scene.enter('registration', { username });
            }
        } else {
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
        }
    } catch (error) {
        console.error('Ошибка при выполнении команды start:', error);
        await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
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
        // Очищаем возможный кэш состояния
        ctx.session = {};
        
        const result = await db.getProfilesForRating(ctx.from.id);
        
        // Если есть сообщение о недоступности анкет
        if (result.message) {
            // Пробуем получить свежие анкеты
            const freshResult = await db.getProfilesForRating(ctx.from.id, true);
            if (freshResult.message) {
                await ctx.reply('Нет доступных анкет для оценки. Попробуйте позже, когда появятся новые пользователи.');
                return;
            }
            result = freshResult;
        }

        // Если нет доступных анкет
        if (!result.rows || result.rows.length === 0) {
            await ctx.reply('Нет доступных анкет для оценки. Попробуйте позже, когда появятся новые пользователи.');
            return;
        }

        // Отправляем первую доступную анкету
        await sendProfileForRating(ctx, result.rows[0]);
    } catch (error) {
        console.error('Ошибка при начале оценивания:', error);
        await ctx.reply('Произошла ошибка при поиске анкет.');
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

const safeSendPhoto = async (telegram, userId, photo, extra = {}) => {
    try {
        await telegram.sendPhoto(userId, photo, extra);
        return true;
    } catch (error) {
        if (error.description?.includes('bot was blocked') || 
            error.message?.includes('bot was blocked') ||
            error.code === 403) {
            try {
                await db.updateUserStatus(userId, false);
            } catch (dbError) {
                console.error('Ошибка обновления статуса пользователя:', dbError);
                // Продолжаем выполнение даже при ошибке обновления статуса
            }
            console.log(`Не удалось отправить фото пользователю ${userId} (бот заблокирован)`);
        } else {
            console.error(`Ошибка отправки фото пользователю ${userId}:`, error);
        }
        return false;
    }
};

exports.whoRatedMeCommand = (bot) => async (ctx) => {
    try {
        const ratings = await db.getLastRatings(ctx.from.id, 10);
        const uniqueRatings = ratings.filter((rating, index, self) =>
            index === self.findIndex((r) => r.from_user_id === rating.from_user_id) && rating.rating >= 7
        );
        
        const totalRatings = uniqueRatings.length;

        if (totalRatings === 0) {
            return await ctx.reply('У вас пока нет оценок 😔');
        }

        if (!ctx.session) ctx.session = {};
        ctx.session.ratings = uniqueRatings;
        ctx.session.totalRatings = totalRatings;

        const escapeMarkdown = (text) => {
            if (!text) return '';
            return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
        };

        const showRating = async (ctx, index) => {
            try {
                const rating = ctx.session.ratings[index];
                const photos = rating.photos || [];

                const caption = `👤 *${escapeMarkdown(rating.name)}*, ${rating.age} лет\n` +
                              `🌆 ${escapeMarkdown(rating.city)}\n` +
                              `⭐️ Оценка: ${rating.rating}/10\n` +
                              `${rating.username ? `📱 @${escapeMarkdown(rating.username)}\n` : ''}`;

                const keyboard = {
                    inline_keyboard: [[
                        { text: '⬅️', callback_data: `who_rated_prev_${index}` },
                        { text: `${index + 1}/${ctx.session.totalRatings}`, callback_data: 'who_rated_count' },
                        { text: '➡️', callback_data: `who_rated_next_${index}` }
                    ]]
                };

                if (ctx.callbackQuery) {
                    try {
                        if (photos.length > 0) {
                            await ctx.editMessageMedia({
                                type: 'photo',
                                media: photos[0],
                                caption: caption,
                                parse_mode: 'MarkdownV2'
                            }, { reply_markup: keyboard });
                        } else {
                            await ctx.editMessageText(caption, {
                                parse_mode: 'MarkdownV2',
                                reply_markup: keyboard
                            });
                        }
                    } catch (e) {
                        if (!e.message.includes('message is not modified')) {
                            throw e;
                        }
                    }
                } else {
                    if (photos.length > 0) {
                        await ctx.replyWithPhoto(photos[0], {
                            caption: caption,
                            parse_mode: 'MarkdownV2',
                            reply_markup: keyboard
                        });
                    } else {
                        await ctx.reply(caption, {
                            parse_mode: 'MarkdownV2',
                            reply_markup: keyboard
                        });
                    }
                }
            } catch (error) {
                console.error('Ошибка при показе рейтинга:', error);
                await ctx.reply('Произошла ошибка при показе рейтинга.');
            }
        };

        // Показываем первую оценку
        await showRating(ctx, 0);

        // Регистрируем обработчики действий
        bot.action(/who_rated_prev_(\d+)/, async (ctx) => {
            try {
                if (!ctx.session?.ratings) {
                    await ctx.answerCbQuery('Сессия истекла. Пожалуйста, запустите команду заново.');
                    return;
                }
                const index = parseInt(ctx.match[1]);
                const newIndex = index > 0 ? index - 1 : ctx.session.totalRatings - 1;
                await ctx.answerCbQuery();
                await showRating(ctx, newIndex);
            } catch (error) {
                console.error('Ошибка при навигации:', error);
                await ctx.answerCbQuery('Произошла ошибка');
            }
        });

        bot.action(/who_rated_next_(\d+)/, async (ctx) => {
            try {
                if (!ctx.session?.ratings) {
                    await ctx.answerCbQuery('Сессия истекла. Пожалуйста, запустите команду заново.');
                    return;
                }
                const index = parseInt(ctx.match[1]);
                const newIndex = index < ctx.session.totalRatings - 1 ? index + 1 : 0;
                await ctx.answerCbQuery();
                await showRating(ctx, newIndex);
            } catch (error) {
                console.error('Ошибка при навигации:', error);
                await ctx.answerCbQuery('Произошла ошибка');
            }
        });

        bot.action('who_rated_count', async (ctx) => {
            try {
                if (!ctx.session?.ratings) {
                    await ctx.answerCbQuery('Сессия истекла. Пожалуйста, запустите команду заново.');
                    return;
                }
                await ctx.answerCbQuery(`Показано ${ctx.session.totalRatings} последних оценок`);
            } catch (error) {
                console.error('Ошибка при показе количества:', error);
                await ctx.answerCbQuery('Произошла ошибка');
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

        // Проверяем блокировку после победы
        const isBlocked = user.last_global_win && 
            (new Date(user.last_global_win).getTime() + 2 * 60 * 60 * 1000 > Date.now());
        
        const minutesLeft = isBlocked ? 
            Math.ceil((new Date(user.last_global_win).getTime() + 2 * 60 * 60 * 1000 - Date.now()) / 60000) : 0;

        if (isBlocked) {
            return ctx.reply(`⚠️ Вы недавно участвовали в глобальной оценке!\nПодождите ещё ${minutesLeft} минут.`);
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

        if (user.in_global_rating) {
            message += `\n\n⏳ Ваша анкета участвует в оценке...`;
        } else if (user.coins >= 50) {
            message += '\n\nНажмите кнопку ниже, чтобы участвовать!';
            keyboard.reply_markup.inline_keyboard.push([
                { text: '🎯 Участвовать за 50 монет', callback_data: 'join_global' }
            ]);
        } else {
            message += '\n\n❌ У вас недостаточно монет для участия';
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
        // Получаем информацию о текущем раунде
        const currentRound = await db.getCurrentGlobalRound();
        if (!currentRound) {
            return ctx.reply('В данный момент нет активного глобального раунда.');
        }

        await db.joinGlobalRating(ctx.from.id);
        await ctx.answerCbQuery('Вы успешно присоединились к глобальной оценке!');
        
        // Форматируем оставшееся время
        const minutesLeft = Math.ceil(currentRound.minutes_left);
        const hours = Math.floor(minutesLeft / 60);
        const minutes = minutesLeft % 60;
        const timeString = hours > 0 
            ? `${hours} ч. ${minutes} мин.`
            : `${minutes} мин.`;

        await ctx.reply(
            '🌟 Ваша анкета участвует в глобальной оценке!\n\n' +
            `⏳ До конца раунда осталось: ${timeString}\n\n` +
            '💫 Чем больше голосов вы получите, тем выше шанс попасть в топ и получить награду!'
        );
    } catch (error) {
        console.error('Ошибка при присоединении к глобальной оценке:', error);
        await ctx.reply('Произошла ошибка при присоединении к глобальной оценке.');
    }
}

async function broadcastTop10(bot) {
    try {
        const top10 = await db.getGlobalRatingTop10();
        const allUsers = await db.getAllUsers();

        let message = '🏆 *Текущий топ-10 участников глобального рейтинга:*\n\n';
        
        top10.forEach((user, index) => {
            const medal = index < 3 ? ['🥇', '🥈', '🥉'][index] : '🎯';
            message += `${medal} ${index + 1}. ${user.name} (ID: ${user.user_id})\n`;
            message += `⭐️ Рейтинг: ${user.total_rating || 0}\n`;
            message += `👥 Голосов: ${user.votes_count || 0}\n\n`;
        });

        // Отправляем сообщение всем пользователям
        for (const user of allUsers) {
            try {
                await bot.telegram.sendMessage(user.user_id, message, {
                    parse_mode: 'Markdown'
                });
                // Небольшая задержка между отправками
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`Ошибка отправки топ-10 пользователю ${user.user_id}:`, error);
            }
        }
    } catch (error) {
        console.error('Ошибка при рассылке топ-10:', error);
    }
}

exports.broadcastGlobalResults = broadcastGlobalResults;

async function safeSendMessage(bot, userId, message, extra = {}) {
    try {
        await bot.telegram.sendMessage(userId, message, extra);
        return true;
    } catch (error) {
        if (error.description?.includes('bot was blocked by the user') || 
            error.message?.includes('bot was blocked by the user') ||
            error.code === 403) {
            // Обновляем статус пользователя в БД
            try {
                await db.updateUserStatus(userId, false);
            } catch (dbError) {
                console.error('Ошибка обновления статуса пользователя:', dbError);
            }
        } else {
            console.error(`Ошибка отправки сообщения пользователю ${userId}:`, error);
        }
        return false;
    }
}

async function broadcastGlobalResults(bot, winners) {
    try {
        const users = await db.getAllUsers();
        
        // Формируем текст с результатами
        let resultsText = '🏆 *Результаты глобального раунда:*\n\n';
        
        winners.forEach((winner, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
            resultsText += `${medal} ${index + 1} место: ${winner.name}\n`;
            resultsText += `💰 Получено монет: ${winner.coins_received}\n`;
            resultsText += `⭐️ Средний рейтинг: ${winner.average_rating.toFixed(2)}\n`;
            resultsText += `👥 Всего голосов: ${winner.total_votes}\n\n`;
        });

        // Отправляем результаты всем пользователям
        for (const user of users) {
            const userWinner = winners.find(w => w.user_id === user.user_id);
            
            if (userWinner) {
                await safeSendMessage(
                    bot,
                    user.user_id,
                    `🎉 *Поздравляем!*\n\n` +
                    `Вы заняли ${userWinner.place} место в глобальном рейтинге!\n` +
                    `💰 Вам начислено ${userWinner.coins_received} монет!\n\n` +
                    resultsText,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await safeSendMessage(
                    bot,
                    user.user_id,
                    resultsText,
                    { parse_mode: 'Markdown' }
                );
            }
        }
    } catch (error) {
        console.error('Ошибка при рассылке результатов:', error);
    }
}

// Функция для запуска периодической проверки и отправки топ-10
function startPeriodicTop10Updates(bot) {
    // Проверяем каждые 30 минут
    setInterval(async () => {
        const currentRound = await db.getCurrentGlobalRound();
        if (currentRound && !currentRound.is_final_voting) {
            await broadcastTop10(bot);
        }
    }, 30 * 60 * 1000); // 30 минут в миллисекундах
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
            // Пытаемся заблокировать повторные нажатия
            await ctx.answerCbQuery('Обработка...');
            
            // Удаляем кнопки сразу после нажатия
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

            const [, targetId, rating] = ctx.match.map(Number);
            
            if (targetId === ctx.from.id) {
                await ctx.reply('Вы не можете оценивать свой профиль!');
                return;
            }

            // Проверяем, участвует ли профиль в глобальном рейтинге
            const targetProfile = await db.getUserProfile(targetId);
            if (targetProfile.in_global_rating) {
                // Сохраняем глобальную оценку
                await db.saveGlobalVote(ctx.from.id, targetId, rating);

                // Получаем следующую глобальную анкету
                const globalProfiles = await db.getGlobalRatingParticipants(ctx.from.id);
                
                if (globalProfiles && globalProfiles.length > 0) {
                    await sendProfileForRating(ctx, globalProfiles[0]);
                } else {
                    await ctx.reply('Вы оценили все анкеты глобального рейтинга! Теперь вам будут показаны обычные анкеты.');
                    
                    const result = await db.getProfilesForRating(ctx.from.id);
                    if (result.rows && result.rows.length > 0) {
                        await sendProfileForRating(ctx, result.rows[0]);
                    } else {
                        await ctx.reply('На данный момент доступных анкет больше нет. Попробуйте позже! 😊', mainMenu);
                    }
                }
                return;
            }

            // Обычная оценка
            const result = await db.saveRating(targetId, ctx.from.id, rating);
            await ctx.answerCbQuery('Оценка сохранена!');

            // Отправляем уведомление только для высоких оценок (7-10)
            if (result && result.shouldNotify) {
                const { raterInfo, photos } = result;
                const escapedUsername = raterInfo.username ? 
                    raterInfo.username.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1') : '';

                const notificationText = `⭐️ *Вас высоко оценили\\!*\n\n` +
                                      `👤 *${raterInfo.name}*, ${raterInfo.age} лет\n` +
                                      `🌆 ${raterInfo.city}\n` +
                                      `⭐️ Оценка: ${rating}/10\n` +
                                      `💰 Получено монет: ${result.coinsAdded}\n` +
                                      `${raterInfo.username ? `\n📱 @${escapedUsername}` : ''}\n`;

                try {
                    if (photos && photos.length > 0) {
                        await safeSendPhoto(bot.telegram, targetId, photos[0], {
                            caption: notificationText,
                            parse_mode: 'MarkdownV2'
                        });
                    } else {
                        await safeSendMessage(bot.telegram, targetId, notificationText, {
                            parse_mode: 'MarkdownV2'
                        });
                    }
                } catch (error) {
                    console.log(`Не удалось отправить уведомление пользователю ${targetId}`);
                }
            }

            // Получаем следующую анкету
            const nextResult = await db.getProfilesForRating(ctx.from.id);
            if (nextResult.rows && nextResult.rows.length > 0) {
                await sendProfileForRating(ctx, nextResult.rows[0]);
            } else {
                await ctx.reply('На данный момент доступных анкет больше нет. Попробуйте позже! 😊', mainMenu);
            }
        } catch (error) {
            console.error('Ошибка при сохранении оценки:', error);
            await ctx.answerCbQuery('Произошла ошибка при сохранении оценки').catch(() => {});
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

    bot.action(/^global_vote_(\d+)_(\d+)$/, async (ctx) => {
        try {
            const [, targetId, rating] = ctx.match.map(Number);
            const voterId = ctx.from.id;

            if (voterId === targetId) {
                await ctx.answerCbQuery('Вы не можете голосовать за себя!');
                return;
            }

            try {
                await db.saveGlobalVote(voterId, targetId, rating);
                await ctx.answerCbQuery('Оценка сохранена!');
                
                // Получаем следующую анкету
                const nextProfiles = await db.getGlobalRatingParticipants(voterId);
                if (nextProfiles && nextProfiles.length > 0) {
                    await sendProfileForRating(ctx, nextProfiles[0]);
                } else {
                    await ctx.reply('Вы оценили все доступные анкеты в глобальном рейтинге!', mainMenu);
                }
            } catch (error) {
                if (error.message === 'Вы уже голосовали за этого участника') {
                    await ctx.answerCbQuery(error.message);
                    // Получаем следующую анкету после ошибки дублирования
                    const nextProfiles = await db.getGlobalRatingParticipants(voterId);
                    if (nextProfiles && nextProfiles.length > 0) {
                        await sendProfileForRating(ctx, nextProfiles[0]);
                    } else {
                        await ctx.reply('Вы оценили все доступные анкеты в глобальном рейтинге!', mainMenu);
                    }
                } else {
                    throw error;
                }
            }
        } catch (error) {
            console.error('Ошибка при сохранении оценки:', error);
            await ctx.answerCbQuery('Произошла ошибка при сохранении оценки');
        }
    });

    bot.action('check_subscription', async (ctx) => {
        try {
            const chatMember = await ctx.telegram.getChatMember('@meetik_info', ctx.from.id);
            
            if (['creator', 'administrator', 'member'].includes(chatMember.status)) {
                await ctx.answerCbQuery('✅ Спасибо за подписку! Теперь вы можете пользоваться ботом');
                await ctx.deleteMessage();
                
                // Показываем главное меню после успешной проверки
                await ctx.reply('Выберите действие:', {
                    reply_markup: mainMenu
                });
            } else {
                await ctx.answerCbQuery('❌ Вы все еще не подписаны на канал');
            }
        } catch (error) {
            console.error('Ошибка при проверке подписки:', error);
            await ctx.answerCbQuery('Произошла ошибка при проверке подписки');
        }
    });

    // Добавляем обработчик для кнопки изменения предпочтений
    bot.action('edit_preferences', async (ctx) => {
        try {
            await ctx.answerCbQuery();
            await ctx.reply('Кого вы хотите видеть в анкетах?', editPreferencesKeyboard);
        } catch (error) {
            console.error('Ошибка при показе клавиатуры предпочтений:', error);
            await ctx.reply('Произошла ошибка. Попробуйте позже.');
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

// Экспортируем новые функции
exports.startPeriodicTop10Updates = startPeriodicTop10Updates;
exports.broadcastTop10 = broadcastTop10;
exports.broadcastGlobalResults = broadcastGlobalResults;
