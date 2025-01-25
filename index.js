require('dotenv').config();
const { startBot } = require('./src/bot');
const db = require('./src/database');

async function start() {
    try {
        // инициализация базы данных
        await db.initDb();
        
        // запуск бота
        await startBot();
        
        // Периодическая проверка и обновление глобального раунда
        setInterval(async () => {
            try {
                await db.checkAndUpdateGlobalRound();
            } catch (error) {
                console.error('Ошибка обновления глобального раунда:', error);
            }
        }, 10 * 1000); // каждые 10 секунд
        
        // обработка завершения работы
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
        
    } catch (error) {
        console.error('Ошибка при запуске приложения:', error);
        process.exit(1);
    }
}

start();