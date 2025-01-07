const { mainMenu } = require('../utils/keyboards');
const { formatDate } = require('../utils/helpers');
const db = require('../database');

exports.startCommand = async (ctx) => {
    const user = await db.getUserProfile(ctx.from.id);
    if (!user) {
        await ctx.scene.enter('registration');
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

exports.whoRatedMeCommand = async (ctx) => {
    try {
        const ratings = await db.getLastRatings(ctx.from.id);
        
        if (!ratings || ratings.length === 0) {
            return ctx.reply('Пока никто не оценил ваш профиль.');
        }

        let message = '🌟 *Последние оценки вашего профиля:*\n\n';
        
        for (const rating of ratings) {
            const raterProfile = await db.getUserProfile(rating.from_user_id);
            if (raterProfile) {
                message += `👤 *${raterProfile.name}*, ${raterProfile.age} лет\n` +
                          `🌆 ${raterProfile.city}\n` +
                          `⭐️ Оценка: ${rating.rating}/10\n` +
                          `🕐 ${formatDate(rating.created_at)}\n`;
                
                if (rating.rating >= 7 && raterProfile.username) {
                    message += `📱 @${raterProfile.username}\n`;
                }
                message += '\n';
            }
        }

        await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка при получении оценок:', error);
        await ctx.reply('Произошла ошибка при загрузке оценок.');
    }
};

exports.globalRatingCommand = async (ctx) => {
    try {
        const user = await db.getUserProfile(ctx.from.id);
        const participantsCount = await db.getGlobalRatingParticipantsCount();
        const currentRound = await db.getCurrentGlobalRound();

        // Проверяем, не заблокирован ли пользователь после победы
        const isBlocked = user.last_global_win && 
            (new Date(user.last_global_win).getTime() + 2 * 60 * 60 * 1000 > Date.now());
        
        const minutesLeft = isBlocked ? 
            Math.ceil((new Date(user.last_global_win).getTime() + 2 * 60 * 60 * 1000 - Date.now()) / 60000) : 0;

        let message = `🌍 *Глобальная оценка*\n\n`;
        message += `💰 Стоимость участия: 50 монет\n`;
        message += `💵 Ваш баланс: ${user.coins} монет\n`;
        message += `👥 Участников: ${participantsCount}/10\n\n`;
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
            const stats = await db.getGlobalRatingParticipants();
            const userRank = stats.findIndex(p => p.user_id === user.user_id) + 1;
            
            message += `\n⏰ До конца раунда: ${timeLeft} минут`;
            message += `\n📊 Ваше текущее место: ${userRank}/${stats.length}`;
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
        } else if (participantsCount < 10 && !user.in_global_rating) {
            if (!isBlocked && user.coins >= 50) {
                message += '\n\nПрисоединяйтесь к текущему раунду!';
                keyboard.reply_markup.inline_keyboard.push([
                    { text: '🎯 Участвовать за 50 монет', callback_data: 'join_global' }
                ]);
            }
        }

        if (currentRound) {
            keyboard.reply_markup.inline_keyboard.push([
                { text: '👀 Оценить анкеты', callback_data: 'view_global_profiles' }
            ]);
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