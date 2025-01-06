require('dotenv').config();
const { Telegraf, Scenes, session } = require('telegraf');
const { message } = require('telegraf/filters');
const config = require('./config');
const db = require('./db');

const bot = new Telegraf(config.BOT_TOKEN);

// Validation functions
const validators = {
    name: (name) => {
        return typeof name === 'string' && 
               name.match(/^[а-яА-ЯёЁa-zA-Z\s]{2,30}$/);
    },
    
    age: (age) => {
        const parsedAge = parseInt(age);
        return !isNaN(parsedAge) && parsedAge >= 14 && parsedAge <= 99;
    },
    
    city: (city) => {
        return typeof city === 'string' && 
               city.match(/^[а-яА-ЯёЁa-zA-Z\s-]{2,50}$/);
    },
    
    description: (desc) => {
        return typeof desc === 'string' && 
               desc.length <= 500;
    },
    
    photo: (photo) => {
        return photo && 
               (!photo.file_size || photo.file_size <= 5242880); // 5MB
    }
};

// Сцены для регистрации
const registrationScene = new Scenes.WizardScene(
    'registration',
    // Шаг 1: Запрос имени
    async (ctx) => {
        await ctx.reply('Добро пожаловать! Как вас зовут? (только буквы, 2-30 символов)');
        return ctx.wizard.next();
    },
    // Шаг 2: Запрос возраста
    async (ctx) => {
        const name = ctx.message.text.trim();
        // Валидация имени: только буквы, 2-30 символов
        if (!name.match(/^[а-яА-ЯёЁa-zA-Z\s]{2,30}$/)) {
            await ctx.reply('Пожалуйста, введите корректное имя (только буквы, 2-30 символов)');
            return;
        }
        ctx.wizard.state.name = name;
        await ctx.reply('Сколько вам лет? (14-99)');
        return ctx.wizard.next();
    },
    // Шаг 3: Запрос города
    async (ctx) => {
        const age = parseInt(ctx.message.text);
        if (isNaN(age) || age < 14 || age > 99) {
            await ctx.reply('Пожалуйста, введите корректный возраст (14-99)');
            return;
        }
        ctx.wizard.state.age = age;
        await ctx.reply('Из какого вы города? (2-50 символов)');
        return ctx.wizard.next();
    },
    // Шаг 4: Запрос пола
    async (ctx) => {
        const city = ctx.message.text.trim();
        // Валидация города: 2-50 символов, буквы и дефис
        if (!city.match(/^[а-яА-ЯёЁa-zA-Z\s-]{2,50}$/)) {
            await ctx.reply('Пожалуйста, введите корректное название города (2-50 символов)');
            return;
        }
        ctx.wizard.state.city = city;
        await ctx.reply('Укажите ваш пол:', {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Мужской ♂️', callback_data: 'gender_male' },
                        { text: 'Женский ♀️', callback_data: 'gender_female' }
                    ]
                ]
            }
        });
        return ctx.wizard.next();
    },
    // Новый шаг: Запрос предпочтений
    async (ctx) => {
        if (!ctx.callbackQuery || !['gender_male', 'gender_female'].includes(ctx.callbackQuery.data)) {
            await ctx.reply('Пожалуйста, выберите пол, используя кнопки выше');
            return;
        }
        const gender = ctx.callbackQuery.data === 'gender_male' ? 'male' : 'female';
        ctx.wizard.state.gender = gender;
        
        await ctx.reply('Кого вы хотите найти?', {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Парней ♂️', callback_data: 'pref_male' },
                        { text: 'Девушек ♀️', callback_data: 'pref_female' }
                    ],
                    [{ text: 'Неважно 🤝', callback_data: 'pref_any' }]
                ]
            }
        });
        return ctx.wizard.next();
    },
    // Шаг 5: Запрос фотографий (обновленный)
    async (ctx) => {
        if (!ctx.callbackQuery || !['pref_male', 'pref_female', 'pref_any'].includes(ctx.callbackQuery.data)) {
            await ctx.reply('Пожалуйста, выберите предпочтения, используя кнопки выше');
            return;
        }
        
        const preferences = ctx.callbackQuery.data === 'pref_male' ? 'male' : 
                           ctx.callbackQuery.data === 'pref_female' ? 'female' : 'any';
        ctx.wizard.state.preferences = preferences;
        
        ctx.wizard.state.photos = [];
        await ctx.reply('Отправьте свою фотографию (минимум 1, максимум 3 фото)');
        return ctx.wizard.next();
    },
    // Шаг 6: Обработка фотографий
    async (ctx) => {
        if (ctx.message?.photo) {
            // Проверка размера фото
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            if (photo.file_size && photo.file_size > 5242880) { // 5MB
                await ctx.reply('Фото слишком большое. Максимальный размер - 5MB');
                return;
            }
            
            const photoId = photo.file_id;
            ctx.wizard.state.photos.push(photoId);
            
            const buttons = [];
            if (ctx.wizard.state.photos.length < 3) {
                buttons.push([{ text: 'Добавить еще фото', callback_data: 'more_photo' }]);
            }
            if (ctx.wizard.state.photos.length >= 1) {
                buttons.push([{ text: 'Продолжить', callback_data: 'continue_registration' }]);
            }

            await ctx.reply(`Фото добавлено! (${ctx.wizard.state.photos.length}/3)`, {
                reply_markup: {
                    inline_keyboard: buttons
                }
            });
        } else if (ctx.callbackQuery) {
            if (ctx.callbackQuery.data === 'more_photo') {
                await ctx.reply('Отправьте следующее фото');
                return;
            } else if (ctx.callbackQuery.data === 'continue_registration') {
                if (ctx.wizard.state.photos.length === 0) {
                    await ctx.reply('Необходимо добавить хотя бы одно фото');
                    return;
                }
                await ctx.reply('Расскажите немного о себе (до 500 символов) или нажмите кнопку "Пропустить"', {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: 'Пропустить', callback_data: 'skip_description' }
                        ]]
                    }
                });
                return ctx.wizard.next();
            }
        }
    },
    // Шаг 7: Обработка описания
    async (ctx) => {
        if (ctx.callbackQuery && ctx.callbackQuery.data === 'skip_description') {
            ctx.wizard.state.description = '';
        } else if (ctx.message?.text) {
            const description = ctx.message.text.trim();
            // Валидация описания
            if (description.length > 500) {
                await ctx.reply('Описание слишком длинное. Максимум 500 символов');
                return;
            }
            ctx.wizard.state.description = description;
        } else {
            return;
        }

        // Сохраняем данные пользователя
        const userData = {
            telegramId: ctx.from.id,
            name: ctx.wizard.state.name,
            age: ctx.wizard.state.age,
            city: ctx.wizard.state.city,
            gender: ctx.wizard.state.gender,
            preferences: ctx.wizard.state.preferences,
            photos: ctx.wizard.state.photos,
            description: ctx.wizard.state.description
        };

        try {
            await db.saveUserProfile(userData);
            await ctx.reply('Регистрация успешно завершена!', mainMenu);
            return ctx.scene.leave();
        } catch (error) {
            console.error('Ошибка при сохранении профиля:', error);
            await ctx.reply('Произошла ошибка при регистрации. Попробуйте позже.');
            return ctx.scene.leave();
        }
    }
);

// Добавляем сцену редактирования профиля
const editProfileScene = new Scenes.WizardScene(
    'edit_profile',
    // Шаг 1: Показ текущего профиля и выбор что редактировать
    async (ctx) => {
        const user = await db.getUserProfile(ctx.from.id);
        if (!user) {
            await ctx.reply('Профиль не найден');
            return ctx.scene.leave();
        }

        await ctx.reply('Что вы хотите изменить?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📝 Имя', callback_data: 'edit_name' }],
                    [{ text: '🎂 Возраст', callback_data: 'edit_age' }],
                    [{ text: '🌆 Город', callback_data: 'edit_city' }],
                    [{ text: '📄 Описание', callback_data: 'edit_description' }],
                    [{ text: '🖼 Фотографии', callback_data: 'edit_photos' }],
                    [{ text: '❌ Отмена', callback_data: 'cancel_edit' }]
                ]
            }
        });
        return ctx.wizard.next();
    },
    // Шаг 2: Обработка выбора и запрос нового значения
    async (ctx) => {
        if (!ctx.callbackQuery) return;

        const action = ctx.callbackQuery.data;
        ctx.wizard.state.editField = action;

        if (action === 'cancel_edit') {
            await ctx.reply('Редактирование отменено', mainMenu);
            return ctx.scene.leave();
        }

        switch (action) {
            case 'edit_name':
                await ctx.reply('Введите новое имя (только буквы, 2-30 символов):');
                break;
            case 'edit_age':
                await ctx.reply('Введите новый возраст (14-99):');
                break;
            case 'edit_city':
                await ctx.reply('Введите новый город (2-50 символов):');
                break;
            case 'edit_description':
                await ctx.reply('Введите новое описание (до 500 символов) или нажмите кнопку "Пропустить"', {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: 'Пропустить', callback_data: 'skip_description' }
                        ]]
                    }
                });
                break;
            case 'edit_photos':
                ctx.wizard.state.photos = [];
                await ctx.reply('Отправьте новые фотографии (минимум 1, максимум 3). Старые фото будут заменены.');
                break;
        }
        return ctx.wizard.next();
    },
    // Шаг 3: Сохранение изменений
    async (ctx) => {
        const editField = ctx.wizard.state.editField;

        try {
            switch (editField) {
                case 'edit_name':
                    const name = ctx.message.text.trim();
                    if (!validators.name(name)) {
                        await ctx.reply('Некорректное имя. Попробуйте еще раз:');
                        return;
                    }
                    await db.updateUserField(ctx.from.id, 'name', name);
                    break;

                case 'edit_age':
                    if (!validators.age(ctx.message.text)) {
                        await ctx.reply('Некорректный возраст. Попробуйте еще раз:');
                        return;
                    }
                    await db.updateUserField(ctx.from.id, 'age', parseInt(ctx.message.text));
                    break;

                case 'edit_city':
                    const city = ctx.message.text.trim();
                    if (!validators.city(city)) {
                        await ctx.reply('Некорректное название города. Попробуйте еще раз:');
                        return;
                    }
                    await db.updateUserField(ctx.from.id, 'city', city);
                    break;

                case 'edit_description':
                    if (ctx.callbackQuery?.data === 'skip_description') {
                        await db.updateUserField(ctx.from.id, 'description', '');
                    } else {
                        const description = ctx.message.text.trim();
                        if (!validators.description(description)) {
                            await ctx.reply('Описание слишком длинное. Попробуйте еще раз:');
                            return;
                        }
                        await db.updateUserField(ctx.from.id, 'description', description);
                    }
                    break;

                case 'edit_photos':
                    if (!ctx.message?.photo || !validators.photo(ctx.message.photo[ctx.message.photo.length - 1])) {
                        await ctx.reply('Некорректное фото. Максимальный размер - 5MB');
                        return;
                    }
                    // ... остальной код обработки фото ...
                    break;
            }

            await ctx.reply('Изменения сохранены!', mainMenu);
            return ctx.scene.leave();
        } catch (error) {
            console.error('Ошибка при обновлении профиля:', error);
            await ctx.reply('Произошла ошибка при обновлении. Попробуйте позже.');
            return ctx.scene.leave();
        }
    }
);

// Создаем менеджер сцен
const stage = new Scenes.Stage([registrationScene, editProfileScene]);
bot.use(session());
bot.use(stage.middleware());

// Главное меню
const mainMenu = {
    reply_markup: {
        keyboard: [
            ['🔍 Начать оценивать', '👑 Лидеры'],
            ['👤 Мой профиль', '💰 Баланс'],
            ['🌍 Глобальный рейтинг', '⭐️ Кто меня оценил']
        ],
        resize_keyboard: true
    }
};

// Обработчики команд
bot.command('start', async (ctx) => {
    const user = await db.getUserProfile(ctx.from.id);
    if (!user) {
        await ctx.scene.enter('registration');
    } else {
        await ctx.reply('Добро пожаловать в главное меню!', mainMenu);
    }
});

bot.hears('👤 Мой профиль', async (ctx) => {
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

        // Добавляем кнопку редактирования
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
});

// Обработчик для кнопки "Начать оценивать"
bot.hears('🔍 Начать оценивать', async (ctx) => {
    try {
        // Получаем профили для оценки
        const profiles = await db.getProfilesForRating(ctx.from.id);
        
        if (!profiles || profiles.length === 0) {
            return ctx.reply('Сейчас нет доступных анкет для оценки. Попробуйте позже.');
        }

        // Отправляем первый профиль
        await sendProfileForRating(ctx, profiles[0]);
    } catch (error) {
        console.error('Ошибка при получении анкет:', error);
        await ctx.reply('Произошла ошибка при загрузке анкет.');
    }
});

// Обработчик для кнопки "Лидеры"
bot.hears('👑 Лидеры', async (ctx) => {
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
});

// Обработчик для кнопки "Баланс"
bot.hears('💰 Баланс', async (ctx) => {
    try {
        const user = await db.getUserProfile(ctx.from.id);
        if (!user) {
            return ctx.reply('Профиль не найден. Используйте /start для регистрации.');
        }

        const wins = await db.getWinsCount(ctx.from.id);
        const rating = user.average_rating ? Number(user.average_rating).toFixed(2) : '0.00';
        const totalRating = user.total_rating || 0;

        const balanceText = `💰 *Ваш баланс:* ${user.coins || 0} монет\n\n` +
            `📊 *Статистика:*\n` +
            `🏆 Побед: ${wins}\n` +
            `⭐️ Текущий рейтинг: ${rating}\n` +
            `📈 Сумма всех оценок: ${totalRating}\n\n` +
            `ℹ️ Следующее участие в рейтинге ${user.last_win_time ? 
                `доступно через ${getTimeUntilNextRating(user.last_win_time)}` : 
                'доступно сейчас'}`;

        await ctx.reply(balanceText, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка при получении баланса:', error);
        await ctx.reply('Произошла ошибка при загрузке баланса.');
    }
});

// Обработчик для кнопки глобального рейтинга
bot.hears('🌍 Глобальный рейтинг', async (ctx) => {
    try {
        const user = await db.getUserProfile(ctx.from.id);
        
        if (!user) {
            return ctx.reply('Профиль не найден. Используйте /start для регистрации.');
        }

        if (user.in_global_rating) {
            return ctx.reply('Вы уже участвуете в глобальном рейтинге! Дождитесь окончания текущего раунда.');
        }

        if (user.last_global_win && Date.now() - new Date(user.last_global_win).getTime() < 24 * 60 * 60 * 1000) {
            return ctx.reply('Вы недавно победили в глобальном рейтинге. Следующее участие будет доступно через 24 часа.');
        }

        const joinMessage = `🌍 *Глобальный рейтинг*\n\n` +
            `Стоимость участия: 50 монет\n` +
            `Награды победителям:\n` +
            `🥇 1 место: 500 монет\n` +
            `🥈 2 место: 300 монет\n` +
            `🥉 3 место: 100 монет\n\n` +
            `Ваш баланс: ${user.coins} монет\n\n` +
            `После победы ваш рейтинг будет сброшен в 0.`;

        await ctx.reply(joinMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '💫 Участвовать', callback_data: 'join_global_rating' },
                    { text: '⭐️ Оценить анкеты', callback_data: 'rate_global_profiles' }
                ]]
            }
        });
    } catch (error) {
        console.error('Ошибка при входе в глобальный рейтинг:', error);
        await ctx.reply('Произошла ошибка. Попробуйте позже.');
    }
});

bot.action('join_global_rating', async (ctx) => {
    try {
        const activeRound = await db.getActiveGlobalRound();
        const participantsCount = await db.getGlobalParticipantsCount();
        
        if (participantsCount >= 10) {
            return ctx.answerCbQuery('❌ Мест для участия больше нет!');
        }

        const result = await db.joinGlobalRating(ctx.from.id);
        
        if (result) {
            await ctx.answerCbQuery('✅ Вы успешно присоединились к глобальному рейтингу!');
            await ctx.reply('Теперь ваша анкета участвует в глобальном рейтинге!\n' +
                          'Победитель будет определен через 5 минут.\n' +
                          'Удачи! 🍀');
        } else {
            await ctx.answerCbQuery('❌ Недостаточно монет для участия!');
        }
    } catch (error) {
        console.error('Ошибка при присоединении к глобальному рейтингу:', error);
        await ctx.answerCbQuery('Произошла ошибка. Попробуйте позже.');
    }
});

bot.action('rate_global_profiles', async (ctx) => {
    try {
        // Получаем активный раунд и профили через методы db
        const activeRound = await db.getActiveGlobalRound();

        if (!activeRound) {
            return ctx.reply('В данный момент нет активного раунда глобального рейтинга.');
        }

        const profile = await db.getNextGlobalProfile(ctx.from.id, activeRound.id);

        if (!profile) {
            return ctx.reply('Вы уже оценили все доступные анкеты в текущем раунде.');
        }

        await sendGlobalProfileForRating(ctx, profile, activeRound.id);
    } catch (error) {
        console.error('Ошибка при получении анкет для оценки:', error);
        await ctx.reply('Произошла ошибка. Попробуйте позже.');
    }
});

// Добавляем функцию отправки анкеты для оценки
async function sendGlobalProfileForRating(ctx, profile, roundId) {
    try {
        const photos = await db.getUserPhotos(profile.user_id);
        const profileText = `👤 *${profile.name}*\n` +
            `🎂 Возраст: ${profile.age}\n` +
            `🌆 Город: ${profile.city}\n` +
            (profile.description ? `📝 О себе: ${profile.description}\n` : '');

        const keyboard = {
            inline_keyboard: [
                [{ text: '👍', callback_data: `global_rate_${profile.user_id}_up_${roundId}` }],
                [{ text: '👎', callback_data: `global_rate_${profile.user_id}_down_${roundId}` }],
                [{ text: '⏩ Пропустить', callback_data: `global_skip_${profile.user_id}_${roundId}` }]
            ]
        };

        if (photos.length > 0) {
            await ctx.replyWithMediaGroup(photos.map((photoId, index) => ({
                type: 'photo',
                media: photoId,
                ...(index === 0 && { caption: profileText, parse_mode: 'Markdown' })
            })));
            await ctx.reply('Оцените анкету:', { reply_markup: keyboard });
        } else {
            await ctx.reply(profileText, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    } catch (error) {
        console.error('Ошибка при отправке анкеты:', error);
        throw error;
    }
}

// Обработчик для кнопки оценки анкет в глобальном рейтинге
bot.action(/^global_rate_(\d+)_(up|down)_(\d+)$/, async (ctx) => {
    try {
        const [, candidateId, action, roundId] = ctx.match;
        const rating = action === 'up' ? 10 : 0;

        // Сохраняем оценку через метод db
        await db.saveGlobalRating(ctx.from.id, candidateId, rating);

        await ctx.answerCbQuery(`Оценка ${action === 'up' ? '👍' : '👎'} сохранена!`);

        // Получаем следующий профиль через метод db
        const nextProfile = await db.getNextGlobalProfile(ctx.from.id, roundId);

        // Удаляем старое сообщение с клавиатурой
        if (ctx.callbackQuery.message) {
            await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
        }

        if (nextProfile) {
            await sendGlobalProfileForRating(ctx, nextProfile, roundId);
        } else {
            await ctx.reply('Вы оценили все доступные анкеты в текущем раунде! 👏');
        }
    } catch (error) {
        console.error('Ошибка при сохранении оценки:', error);
        await ctx.answerCbQuery('Произошла ошибка при сохранении оценки.');
    }
});

// Вспомогательная функция для отправки профиля на оценку
async function sendProfileForRating(ctx, profile) {
    const profileText = `👤 *Анкета для оценки:*\n` +
        `📝 Имя: ${profile.name}\n` +
        `🎂 Возраст: ${profile.age}\n` +
        `🌆 Город: ${profile.city}\n` +
        `${profile.description ? `📄 О себе: ${profile.description}\n` : ''}`;

    // Исправляем доступ к ID пользователя
    const userId = profile.user_id; // Изменено с profile.telegramId на profile.user_id

    // Создаем клавиатуру с оценками
    const ratingKeyboard = {
        inline_keyboard: [
            [
                { text: '1️⃣', callback_data: `rate_1_${userId}` },
                { text: '2️⃣', callback_data: `rate_2_${userId}` },
                { text: '3️⃣', callback_data: `rate_3_${userId}` },
                { text: '4️⃣', callback_data: `rate_4_${userId}` },
                { text: '5️⃣', callback_data: `rate_5_${userId}` }
            ],
            [
                { text: '6️⃣', callback_data: `rate_6_${userId}` },
                { text: '7️⃣', callback_data: `rate_7_${userId}` },
                { text: '8️⃣', callback_data: `rate_8_${userId}` },
                { text: '9️⃣', callback_data: `rate_9_${userId}` },
                { text: '🔟', callback_data: `rate_10_${userId}` }
            ],
            [{ text: '⏩ Пропустить', callback_data: `skip_${userId}` }]
        ]
    };

    // Отправляем фотографии профиля
    if (profile.photos && profile.photos.length > 0) {
        const mediaGroup = profile.photos.map((photoId, index) => ({
            type: 'photo',
            media: photoId,
            ...(index === 0 && { caption: profileText, parse_mode: 'Markdown' })
        }));

        await ctx.replyWithMediaGroup(mediaGroup);
        await ctx.reply('Оцените анкету:', { reply_markup: ratingKeyboard });
    } else {
        await ctx.reply(profileText, {
            parse_mode: 'Markdown',
            reply_markup: ratingKeyboard
        });
    }
}

// Обновляем обработчик оценок
bot.action(/^rate_(\d+)_(\d+)$/, async (ctx) => {
    try {
        const [, rating, targetId] = ctx.match;
        const ratingNum = parseInt(rating);
        const targetIdNum = parseInt(targetId);

        // Получаем профиль оцениваемого пользователя
        const targetProfile = await db.getUserProfile(targetIdNum);
        
        try {
            // Убираем проверку на глобальный рейтинг, так как этот обработчик 
            // должен использоваться только для обычных оценок
            const ratingResult = await db.saveRating(targetIdNum, ctx.from.id, ratingNum);
            
            await ctx.answerCbQuery('✅ Оценка сохранена!');
            
            // Остальной код без изменений...
        } catch (error) {
            if (error.message === 'Вы уже оценили этого пользователя') {
                await ctx.answerCbQuery('⚠️ Вы уже оценили этого пользователя');
                return;
            }
            throw error;
        }
    } catch (error) {
        console.error('Ошибка при сохранении оценки:', error);
        await ctx.answerCbQuery('Произошла ошибка при сохранении оценки.');
    }
});

// Обработчик кнопки "Пропустить"
bot.action(/^skip_(\d+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const targetId = ctx.match[1]; // Получаем ID пропускаемого профиля
        
        // Сохраняем информацию о пропуске в базу данных
        await db.saveSkip(ctx.from.id, targetId);
        
        const nextProfile = await db.getNextProfile(ctx.from.id);
        
        // Удаляем старую клавиатуру
        if (ctx.callbackQuery.message) {
            await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
        }
        
        if (nextProfile) {
            await sendProfileForRating(ctx, nextProfile);
        } else {
            await ctx.reply('Больше нет доступных анкет для оценки. Приходите позже.');
        }
    } catch (error) {
        console.error('Ошибка при пропуске профиля:', error);
        await ctx.answerCbQuery('Произошла ошибка при пропуске профиля.');
    }
});

// Функция для запуска регулярного обновления победителей
function startWinnersUpdate() {
    setInterval(async () => {
        try {
            const winners = await db.updateWinners();
            const winnersList = await db.getCurrentRoundWinners();
            
            if (winnersList && winnersList.length > 0) {
                let message = '🏆 *Итоги раунда:*\n\n';
                winnersList.forEach((winner, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
                    message += `${medal} ${winner.place}. ${winner.name}\n` +
                              `⭐️ Рейтинг: ${winner.average_rating.toFixed(2)}\n` +
                              `💰 Получено монет: ${winner.coins_received}\n\n`;
                });
                
                // TODO: Добавить отправку сообщения всем пользователям или в канал
            }
            
        } catch (error) {
            console.error('Ошибка при обновлении победителей:', error);
        }
    }, 10000);
}

// Добавляем функцию для запуска проверки глобального рейтинга
function startGlobalRatingUpdate() {
    // Запускаем сразу при старте бота
    checkAndUpdateGlobalRating();
    
    // Затем проверяем каждый час
    setInterval(checkAndUpdateGlobalRating, 60 * 60 * 1000);
}

async function checkAndUpdateGlobalRating() {
    try {
        // Проверяем активный раунд
        const activeRound = await pool.query(`
            SELECT * FROM global_rounds 
            WHERE is_active = true
            LIMIT 1
        `);

        // Если нет активного раунда, создаем новый
        if (activeRound.rows.length === 0) {
            const now = new Date();
            const registrationEndTime = new Date(now.getTime() + 5 * 60 * 1000); // +5 минут на регистрацию
            const votingEndTime = new Date(registrationEndTime.getTime() + 5 * 60 * 1000); // +5 минут на голосование

            const newRound = await pool.query(`
                INSERT INTO global_rounds (start_time, registration_end_time, voting_end_time, is_active)
                VALUES ($1, $2, $3, true)
                RETURNING *
            `, [now, registrationEndTime, votingEndTime]);

            // Оповещаем всех пользователей о начале нового раунда
            const users = await pool.query('SELECT user_id FROM users');
            for (const user of users.rows) {
                try {
                    await bot.telegram.sendMessage(user.user_id, 
                        '🌟 Начался новый раунд глобального рейтинга!\n\n' +
                        'У вас есть 5 минут, чтобы присоединиться.\n' +
                        'Стоимость участия: 50 монет\n\n' +
                        'Награды:\n' +
                        '🥇 1 место: 500 монет\n' +
                        '🥈 2 место: 300 монет\n' +
                        '🥉 3 место: 100 монет', {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '💫 Участвовать', callback_data: 'join_global_rating' }
                            ]]
                        }
                    });
                } catch (error) {
                    console.error(`Ошибка отправки сообщения пользователю ${user.user_id}:`, error);
                }
            }

            // Запускаем таймер для начала голосования
            setTimeout(async () => {
                await startGlobalVoting(newRound.rows[0].id);
            }, 5 * 60 * 1000);
        }
    } catch (error) {
        console.error('Ошибка при проверке глобального рейтинга:', error);
    }
}

async function startGlobalVoting(roundId) {
    try {
        // Получаем всех участников раунда
        const participants = await pool.query(`
            SELECT u.* FROM users u
            WHERE u.in_global_rating = true
            LIMIT 10
        `);

        if (participants.rows.length < 2) {
            // Если участников меньше 2, отменяем раунд и возвращаем монеты
            await pool.query(`
                UPDATE users 
                SET coins = coins + 50, in_global_rating = false 
                WHERE in_global_rating = true
            `);
            return;
        }

        // Получаем всех пользователей, которые могут голосовать
        const voters = await pool.query(`
            SELECT user_id FROM users 
            WHERE (last_global_win IS NULL OR 
                  last_global_win < NOW() - INTERVAL '2 hours')
        `);

        // Отправляем каждому пользователю первую анкету для голосования
        for (const voter of voters.rows) {
            try {
                await sendProfileForVoting(voter.user_id, 0, participants.rows, roundId);
            } catch (error) {
                console.error(`Ошибка отправки анкеты пользователю ${voter.user_id}:`, error);
            }
        }

        // Запускаем таймер для подведения итогов
        setTimeout(async () => {
            await finishGlobalRating(roundId);
        }, 5 * 60 * 1000);
    } catch (error) {
        console.error('Ошибка при старте голосования:', error);
    }
}

async function sendProfileForVoting(userId, index, profiles, roundId) {
    const profile = profiles[index];
    const photos = await db.getUserPhotos(profile.user_id);
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: '⬅️', callback_data: `vote_prev_${roundId}_${index}` },
                { text: '✨ Выбрать', callback_data: `vote_select_${roundId}_${profile.user_id}` },
                { text: '➡️', callback_data: `vote_next_${roundId}_${index}` }
            ]
        ]
    };

    const caption = `👤 *${profile.name}*, ${profile.age}\n` +
                   `🌆 ${profile.city}\n` +
                   `${profile.description ? `📝 ${profile.description}\n` : ''}` +
                   `\n${index + 1}/${profiles.length}`;

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
}

// Обновляем запуск бота
bot.launch().then(() => {
    console.log('Бот запущен');
    startWinnersUpdate();
    startGlobalRatingUpdate(); // Добавляем запуск проверки глобального рейтинга
}).catch((err) => {
    console.error('Ошибка при запуске бота:', err);
});

// Вспомогательная функция для расчета времени до следующего участия
function getTimeUntilNextRating(lastWinTime) {
    const nextAvailableTime = new Date(lastWinTime);
    nextAvailableTime.setHours(nextAvailableTime.getHours() + 2);
    
    const now = new Date();
    const diff = nextAvailableTime - now;
    
    if (diff <= 0) return 'сейчас';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours}ч ${minutes}м`;
}

// Добавляем обработчик кнопки редактирования
bot.action('edit_profile', async (ctx) => {
    await ctx.scene.enter('edit_profile');
});

// Обработчик для кнопки "Кто меня оценил"
bot.hears('⭐️ Кто меня оценил', async (ctx) => {
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
                
                // Добавляем username если оценка высокая
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
});

// Вспомогательная функция для форматирования даты
function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleString('ru-RU', { 
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function sendVotingMessage(userId, candidates, currentIndex) {
    if (!candidates || candidates.length === 0) {
        return bot.telegram.sendMessage(userId, 'Нет доступных кандидатов для голосования.');
    }

    const candidate = candidates[currentIndex];
    const photos = candidate.photos || [];
    const caption = `👤 *${candidate.name}*, ${candidate.age} лет\n` +
                   `🌆 ${candidate.city}\n` +
                   `📝 ${candidate.description || 'Нет описания'}\n` +
                   `⭐️ Текущий рейтинг: ${Number(candidate.global_rating).toFixed(2)}\n\n` +
                   `Кандидат ${currentIndex + 1} из ${candidates.length}`;

    const keyboard = {
        inline_keyboard: [
            [
                currentIndex > 0 ? 
                    { text: '⬅️ Предыдущий', callback_data: `vote_prev_${currentIndex}` } : 
                    { text: '⬅️', callback_data: 'noop' },
                { text: '✅ Выбрать', callback_data: `vote_select_${candidate.user_id}` },
                currentIndex < candidates.length - 1 ? 
                    { text: 'Следующий ➡️', callback_data: `vote_next_${currentIndex}` } : 
                    { text: '➡️', callback_data: 'noop' }
            ]
        ]
    };

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
}

// Обработчик для кнопок навигации
bot.action(/^vote_(prev|next)_(\d+)_(\d+)$/, async (ctx) => {
    try {
        const [, direction, roundId, currentIndex] = ctx.match;
        const participants = await pool.query(`
            SELECT u.* FROM users u
            WHERE u.in_global_rating = true
            ORDER BY u.user_id
        `);

        let newIndex = parseInt(currentIndex);
        if (direction === 'next') {
            newIndex = (newIndex + 1) % participants.rows.length;
        } else {
            newIndex = (newIndex - 1 + participants.rows.length) % participants.rows.length;
        }

        await ctx.deleteMessage();
        await sendProfileForVoting(ctx.from.id, newIndex, participants.rows, roundId);
    } catch (error) {
        console.error('Ошибка при навигации:', error);
        await ctx.answerCbQuery('Произошла ошибка');
    }
});

// Обработчик для кнопки выбора
bot.action(/^vote_select_(\d+)_(\d+)$/, async (ctx) => {
    try {
        const [, roundId, selectedUserId] = ctx.match;
        
        // Сохраняем голос
        await pool.query(`
            INSERT INTO global_votes (round_id, voter_id, candidate_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (round_id, voter_id) DO UPDATE
            SET candidate_id = $3
        `, [roundId, ctx.from.id, selectedUserId]);

        await ctx.answerCbQuery('✅ Ваш голос учтен!');
        await ctx.deleteMessage();
    } catch (error) {
        console.error('Ошибка при голосовании:', error);
        await ctx.answerCbQuery('Произошла ошибка');
    }
});

async function finishGlobalRating(roundId) {
    try {
        // Получаем результаты голосования с учетом средних оценок
        const results = await pool.query(`
            SELECT 
                u.user_id,
                u.name,
                COALESCE(AVG(gv.rating), 0) as average_rating,
                COUNT(DISTINCT gv.voter_id) as total_votes
            FROM users u
            LEFT JOIN global_votes gv ON u.user_id = gv.candidate_id
            WHERE u.in_global_rating = true
            AND gv.round_id = $1
            GROUP BY u.user_id, u.name
            ORDER BY average_rating DESC, total_votes DESC
        `, [roundId]);

        // Распределяем награды
        const rewards = [500, 300, 100];
        for (let i = 0; i < Math.min(results.rows.length, rewards.length); i++) {
            const winner = results.rows[i];
            await pool.query(`
                UPDATE users
                SET coins = coins + $1,
                    last_global_win = CURRENT_TIMESTAMP
                WHERE user_id = $2
            `, [rewards[i], winner.user_id]);
        }

        // Сбрасываем флаг участия у всех остальных
        await pool.query(`
            UPDATE users
            SET in_global_rating = false
            WHERE in_global_rating = true
        `);

        // Завершаем раунд
        await pool.query(`
            UPDATE global_rounds
            SET is_active = false
            WHERE id = $1
        `, [roundId]);

        // Отправляем результаты всем участникам
        const participants = await pool.query(`
            SELECT DISTINCT user_id 
            FROM users 
            WHERE user_id IN (SELECT voter_id FROM global_votes WHERE round_id = $1)
        `, [roundId]);

        let message = '🏆 *Итоги глобального рейтинга:*\n\n';
        results.rows.forEach((result, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
            message += `${medal} ${result.name}\n` +
                      `⭐️ Средняя оценка: ${result.average_rating.toFixed(2)}\n` +
                      `👥 Всего голосов: ${result.total_votes}\n`;
            if (index < 3) {
                message += `💰 +${rewards[index]} монет\n`;
            }
            message += '\n';
        });

        for (const participant of participants.rows) {
            try {
                await bot.telegram.sendMessage(participant.user_id, message, {
                    parse_mode: 'Markdown'
                });
            } catch (error) {
                console.error(`Ошибка отправки результатов пользователю ${participant.user_id}:`, error);
            }
        }
    } catch (error) {
        console.error('Ошибка при завершении раунда:', error);
    }
}

async function saveGlobalRating(fromUserId, toUserId, rating) {
    try {
        // Validate rating
        const parsedRating = parseInt(rating);
        if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 10) {
            throw new Error('Некорректная оценка. Должна быть от 1 до 10');
        }

        // Validate users exist
        const [voter, candidate] = await Promise.all([
            pool.query('SELECT * FROM users WHERE user_id = $1', [fromUserId]),
            pool.query('SELECT * FROM users WHERE user_id = $1', [toUserId])
        ]);

        if (!voter.rows.length || !candidate.rows.length) {
            throw new Error('Пользователь не найден');
        }

        // Check if user is voting for themselves
        if (fromUserId === toUserId) {
            throw new Error('Нельзя голосовать за себя');
        }

        // Check if already rated
        const existingRating = await pool.query(`
            SELECT * FROM global_ratings 
            WHERE from_user_id = $1 AND to_user_id = $2
        `, [fromUserId, toUserId]);

        if (existingRating.rows.length > 0) {
            throw new Error('Вы уже оценили этого пользователя');
        }

        // Save rating
        await pool.query(`
            INSERT INTO global_ratings (from_user_id, to_user_id, rating)
            VALUES ($1, $2, $3)
        `, [fromUserId, toUserId, rating]);

    } catch (error) {
        throw error;
    }
}
