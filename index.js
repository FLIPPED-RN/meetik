require('dotenv').config();
const { startBot } = require('./src/bot');
const db = require('./src/database');

async function start() {
    try {
        // Инициализация базы данных
        await db.initDb();
        console.log('База данных инициализирована');
        
        // Запуск бота
        await startBot();
        
        // Обработка завершения работы
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
        
    } catch (error) {
        console.error('Ошибка при запуске приложения:', error);
        process.exit(1);
    }
}

start(); 