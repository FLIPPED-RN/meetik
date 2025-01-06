require('dotenv').config();
const { Telegraf, Scenes, session } = require('telegraf');
const { message } = require('telegraf/filters');
const config = require('./config');
const db = require('./db');

const bot = new Telegraf(config.BOT_TOKEN);

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
        await ctx.reply('Сколько вам лет? (18-100)');
        return ctx.wizard.next();
    },
    // Шаг 3: Запрос города
    async (ctx) => {
        const age = parseInt(ctx.message.text);
        if (isNaN(age) || age < 18 || age > 100) {
            await ctx.reply('Пожалуйста, введите корректный возраст (18-100)');
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
                await ctx.reply('Введите новый возраст (18-100):');
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
                    if (!name.match(/^[а-яА-ЯёЁa-zA-Z\s]{2,30}$/)) {
                        await ctx.reply('Некорректное имя. Попробуйте еще раз:');
                        return;
                    }
                    await db.updateUserField(ctx.from.id, 'name', name);
                    break;

                case 'edit_age':
                    const age = parseInt(ctx.message.text);
                    if (isNaN(age) || age < 18 || age > 100) {
                        await ctx.reply('Некорректный возраст. Попробуйте еще раз:');
                        return;
                    }
                    await db.updateUserField(ctx.from.id, 'age', age);
                    break;

                case 'edit_city':
                    const city = ctx.message.text.trim();
                    if (!city.match(/^[а-яА-ЯёЁa-zA-Z\s-]{2,50}$/)) {
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
                        if (description.length > 500) {
                            await ctx.reply('Описание слишком длинное. Попробуйте еще раз:');
                            return;
                        }
                        await db.updateUserField(ctx.from.id, 'description', description);
                    }
                    break;

                case 'edit_photos':
                    if (ctx.message?.photo) {
                        const photo = ctx.message.photo[ctx.message.photo.length - 1];
                        if (photo.file_size && photo.file_size > 5242880) {
                            await ctx.reply('Фото слишком большое. Максимальный размер - 5MB');
                            return;
                        }
                        
                        ctx.wizard.state.photos.push(photo.file_id);
                        
                        const buttons = [];
                        if (ctx.wizard.state.photos.length < 3) {
                            buttons.push([{ text: 'Добавить еще фото', callback_data: 'more_photo' }]);
                        }
                        if (ctx.wizard.state.photos.length >= 1) {
                            buttons.push([{ text: 'Сохранить', callback_data: 'save_photos' }]);
                        }

                        await ctx.reply(`Фото добавлено! (${ctx.wizard.state.photos.length}/3)`, {
                            reply_markup: {
                                inline_keyboard: buttons
                            }
                        });
                        return;
                    } else if (ctx.callbackQuery) {
                        if (ctx.callbackQuery.data === 'more_photo') {
                            await ctx.reply('Отправьте следующее фото');
                            return;
                        } else if (ctx.callbackQuery.data === 'save_photos') {
                            await db.updateUserPhotos(ctx.from.id, ctx.wizard.state.photos);
                        }
                    }
                    break;
            }

            await ctx.reply('Изменения сохранены!', mainMenu);
            return ctx.scene.leave();
        } catch (error) {
            console.error('Ошибка при обновлении профиля:', error);
            await ctx.reply('Произошла ошибка при сохранении изменений');
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
            ['🌍 Глобальный рейтинг']
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
            `Награда победителю: 500 монет\n\n` +
            `Ваш баланс: ${user.coins} монет\n\n` +
            `После победы ваш рейтинг будет сброшен в 0.`;

        await ctx.reply(joinMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '💫 Участвовать', callback_data: 'join_global_rating' }
                ]]
            }
        });
    } catch (error) {
        console.error('Ошибка при входе в глобальный рейтинг:', error);
        await ctx.reply('Произошла ошибка. Попробуйте позже.');
    }
});

// Обработчик для кнопки участия в глобальном рейтинге
bot.action('join_global_rating', async (ctx) => {
    try {
        const result = await db.joinGlobalRating(ctx.from.id);
        
        if (result) {
            await ctx.answerCbQuery('✅ Вы успешно присоединились к глобальному рейтингу!');
            await ctx.reply('Теперь ваша анкета участвует в глобальном рейтинге!\n' +
                          'Победитель будет определен через 24 часа.\n' +
                          'Удачи! 🍀');
        } else {
            await ctx.answerCbQuery('❌ Недостаточно монет для участия!');
        }
    } catch (error) {
        console.error('Ошибка при присоединении к глобальному рейтингу:', error);
        await ctx.answerCbQuery('Произошла ошибка. Попробуйте позже.');
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

// Обработчик оценок (обновленный)
bot.action(/^rate_(\d+)_(\d+)$/, async (ctx) => {
    try {
        const [, rating, targetId] = ctx.match;
        console.log('Rating:', rating, 'Target ID:', targetId);

        await db.saveRating(parseInt(targetId), ctx.from.id, parseInt(rating));
        await ctx.answerCbQuery('✅ Оценка сохранена!');
        
        // Добавляем обработку высоких оценок
        if (parseInt(rating) >= 7) {
            const ratedUser = await db.getUserProfile(parseInt(targetId));
            const ratedUserPhotos = await db.getUserPhotos(parseInt(targetId));
            
            const matchText = `🌟 *Отличный выбор!*\n\n` +
                `Вы поставили высокую оценку пользователю:\n` +
                `👤 *${ratedUser.name}*\n` +
                `🎂 Возраст: ${ratedUser.age}\n` +
                `🌆 Город: ${ratedUser.city}\n` +
                `${ratedUser.username ? `👤 Username: @${ratedUser.username}\n` : ''}`+
                `${ratedUser.description ? `📄 О себе: ${ratedUser.description}\n` : ''}\n` +
                `Желаем приятного общения! 😊`;

            if (ratedUserPhotos.length > 0) {
                const mediaGroup = ratedUserPhotos.map((photoId, index) => ({
                    type: 'photo',
                    media: photoId,
                    ...(index === 0 && { caption: matchText, parse_mode: 'Markdown' })
                }));
                await ctx.replyWithMediaGroup(mediaGroup);
            } else {
                await ctx.reply(matchText, { parse_mode: 'Markdown' });
            }
        }
        
        const nextProfile = await db.getNextProfile(ctx.from.id);
        
        // Удаляем старые сообщения с клавиатурой
        if (ctx.callbackQuery.message) {
            try {
                await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
            } catch (error) {
                console.log('Ошибка при удалении сообщения:', error);
            }
        }
        
        if (nextProfile) {
            await sendProfileForRating(ctx, nextProfile);
        } else {
            await ctx.reply('Вы оценили все доступные анкеты! Приходите позже.');
        }
    } catch (error) {
        console.error('Ошибка при сохранении оценки:', error);
        await ctx.answerCbQuery('Произошла ошибка при сохранении оценки.');
    }
});

// Добавьте обработчик для кнопки "Пропустить"
bot.action(/^skip_(\d+)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
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
    }, 10000); // 10 секунд
}

// Добавляем функцию для запуска проверки глобального рейтинга
function startGlobalRatingUpdate() {
    setInterval(async () => {
        try {
            const winner = await db.updateGlobalWinner();
            
            if (winner) {
                // Отправляем сообщение победителю
                await bot.telegram.sendMessage(winner.user_id,
                    '🎉 Поздравляем! Вы победили в глобальном рейтинге!\n' +
                    '💰 На ваш счет начислено 500 монет!\n' +
                    '⚠️ Ваш рейтинг сброшен для следующего участия.'
                );
            }
        } catch (error) {
            console.error('Ошибка при обновлении глобального рейтинга:', error);
        }
    }, 24 * 60 * 60 * 1000); // Проверка каждые 24 часа
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
