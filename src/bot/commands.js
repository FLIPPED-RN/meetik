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