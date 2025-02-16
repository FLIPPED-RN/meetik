const db = require('../database');

const errorHandler = async (ctx, next) => {
    try {
        await next();
    } catch (error) {
        console.error('Ошибка в middleware:', error);
        
        // Проверяем, не заблокировал ли пользователь бота
        if (error.description?.includes('bot was blocked by the user') || 
            error.message?.includes('bot was blocked by the user') ||
            error.code === 403) {
            // Можно добавить логику для обработки блокировки
            // Например, пометить пользователя как неактивного в БД
            try {
                await db.updateUserStatus(ctx.from.id, false);
            } catch (dbError) {
                console.error('Ошибка обновления статуса пользователя:', dbError);
            }
            return;
        }

        // Для остальных ошибок пытаемся отправить сообщение
        try {
            await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже.');
        } catch (replyError) {
            console.error('Ошибка отправки сообщения об ошибке:', replyError);
        }
    }
};

const userCheck = async (ctx, next) => {
    try {
        // Пропускаем проверку для команды start
        if (ctx.message && ctx.message.text === '/start') {
            return next();
        }

        const user = await db.getUserProfile(ctx.from.id);
        if (!user) {
            await ctx.reply('Пожалуйста, зарегистрируйтесь с помощью команды /start');
            return;
        }
        
        ctx.user = user;
        return next();
    } catch (error) {
        console.error('Ошибка при проверке пользователя:', error);
        await ctx.reply('Произошла ошибка при проверке профиля.');
    }
};

const rateLimit = async (ctx, next) => {
    const now = Date.now();
    const userId = ctx.from.id;
    
    if (global.rateLimit && global.rateLimit[userId]) {
        const diff = now - global.rateLimit[userId];
        if (diff < 1000) {
            return;
        }
    }
    
    if (!global.rateLimit) global.rateLimit = {};
    global.rateLimit[userId] = now;
    
    return next();
};

const checkSubscription = async (ctx, next) => {
    try {
        // Пропускаем только callback check_subscription
        if (ctx.callbackQuery?.data === 'check_subscription') {
            return next();
        }

        // Получаем ID пользователя в зависимости от типа обновления
        const userId = ctx.from?.id;
        if (!userId) return next();

        const chatMember = await ctx.telegram.getChatMember('@meetik_info', userId);
        
        // Проверяем статус подписки
        if (['creator', 'administrator', 'member'].includes(chatMember.status)) {
            return next();
        }

        // Если пользователь не подписан, отправляем сообщение
        const keyboard = {
            inline_keyboard: [
                [{ text: '📢 Подписаться на канал', url: 'https://t.me/meetik_info' }],
                [{ text: '🔄 Проверить подписку', callback_data: 'check_subscription' }]
            ]
        };

        // Если это callback query, отвечаем через answerCbQuery
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('Необходимо подписаться на канал', { show_alert: true });
        }

        // Отправляем сообщение о необходимости подписки
        await ctx.reply(
            '❗️ Для использования бота необходимо подписаться на наш канал @meetik_info',
            { reply_markup: keyboard }
        );
        
        return; // Прерываем выполнение следующих middleware
        
    } catch (error) {
        console.error('Ошибка при проверке подписки:', error);
        if (error.message.includes('user not found')) {
            const keyboard = {
                inline_keyboard: [
                    [{ text: '📢 Подписаться на канал', url: 'https://t.me/meetik_info' }],
                    [{ text: '🔄 Проверить подписку', callback_data: 'check_subscription' }]
                ]
            };
            
            await ctx.reply(
                '❗️ Для использования бота необходимо подписаться на наш канал @meetik_info',
                { reply_markup: keyboard }
            );
            return;
        }
        return next();
    }
};

module.exports = {
    errorHandler,
    userCheck,
    rateLimit,
    checkSubscription
}; 