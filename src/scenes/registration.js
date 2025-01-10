const { Scenes } = require('telegraf');
const validators = require('../utils/validators');
const { mainMenu, genderKeyboard, preferencesKeyboard } = require('../utils/keyboards');
const db = require('../database');

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
        if (!validators.name(name)) {
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
        if (!validators.age(age)) {
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
        if (!validators.city(city)) {
            await ctx.reply('Пожалуйста, введите корректное название города (2-50 символов)');
            return;
        }
        ctx.wizard.state.city = city;
        await ctx.reply('Укажите ваш пол:', genderKeyboard);
        return ctx.wizard.next();
    },
    // Шаг 5: Запрос предпочтений
    async (ctx) => {
        if (!ctx.callbackQuery || !['gender_male', 'gender_female'].includes(ctx.callbackQuery.data)) {
            await ctx.reply('Пожалуйста, выберите пол, используя кнопки выше');
            return;
        }
        const gender = ctx.callbackQuery.data === 'gender_male' ? 'male' : 'female';
        ctx.wizard.state.gender = gender;
        
        await ctx.reply('Кого вы хотите найти?', preferencesKeyboard);
        return ctx.wizard.next();
    },
    // Шаг 6: Запрос фотографий
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
    // Шаг 7: Обработка фотографий
    async (ctx) => {
        if (ctx.message?.photo) {
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            if (!validators.photo(photo)) {
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
                reply_markup: { inline_keyboard: buttons }
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
    // Шаг 8: Обработка описания и завершение регистрации
    async (ctx) => {
        if (ctx.callbackQuery && ctx.callbackQuery.data === 'skip_description') {
            ctx.wizard.state.description = '';
        } else if (ctx.message?.text) {
            const description = ctx.message.text.trim();
            if (!validators.description(description)) {
                await ctx.reply('Описание слишком длинное. Максимум 500 символов');
                return;
            }
            ctx.wizard.state.description = description;
        } else {
            return;
        }

        const userData = {
            telegramId: ctx.from.id,
            name: ctx.wizard.state.name,
            age: ctx.wizard.state.age,
            city: ctx.wizard.state.city,
            gender: ctx.wizard.state.gender,
            preferences: ctx.wizard.state.preferences,
            photos: ctx.wizard.state.photos,
            description: ctx.wizard.state.description,
            username
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

module.exports = registrationScene; 