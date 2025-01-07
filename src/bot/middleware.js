exports.errorHandler = async (ctx, next) => {
    try {
        await next();
    } catch (error) {
        console.error('Ошибка в обработчике:', error);
        await ctx.reply('Произошла ошибка. Попробуйте позже или обратитесь к администратору.');
    }
};

exports.userCheck = async (ctx, next) => {
    if (ctx.from && ['private'].includes(ctx.chat?.type)) {
        return next();
    }
};

exports.rateLimit = async (ctx, next) => {
    const now = Date.now();
    const userId = ctx.from.id;
    
    if (global.rateLimit && global.rateLimit[userId]) {
        const diff = now - global.rateLimit[userId];
        if (diff < 1000) { // 1 секунда
            return;
        }
    }
    
    if (!global.rateLimit) global.rateLimit = {};
    global.rateLimit[userId] = now;
    
    return next();
}; 