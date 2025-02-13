const { Scenes } = require('telegraf');
const validators = require('../utils/validators');
const { mainMenu, preferencesKeyboard } = require('../utils/keyboards');
const db = require('../database');

const editProfileScene = new Scenes.WizardScene(
    'edit_profile',
    async (ctx) => {
        const user = await db.getUserProfile(ctx.from.id);
        if (!user) {
            await ctx.reply('Профиль не найден');
            return ctx.scene.leave();
        }

        await ctx.reply('Что вы хотите изменить?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Имя ✏️', callback_data: 'edit_name' }],
                    [{ text: 'Возраст 🎂', callback_data: 'edit_age' }],
                    [{ text: 'Город 🌆', callback_data: 'edit_city' }],
                    [{ text: 'Пол 🚻', callback_data: 'edit_gender' }],
                    [{ text: 'Описание 📝', callback_data: 'edit_description' }],
                    [{ text: 'Фотографии 📸', callback_data: 'edit_photos' }],
                    [{ text: 'Предпочтения ❤️', callback_data: 'edit_preferences' }],
                    [{ text: 'Отмена ❌', callback_data: 'cancel_edit' }]
                ]
            }
        });
        return ctx.wizard.next();
    },
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
            case 'edit_gender':
                await ctx.reply('Выберите пол:', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Мужской', callback_data: 'pref_male' }],
                            [{ text: 'Женский', callback_data: 'pref_female' }],
                            [{ text: 'Любой', callback_data: 'pref_any' }]
                        ]
                    }
                });
                break;
            case 'edit_preferences':
                await ctx.reply('Кого вы хотите найти?', preferencesKeyboard);
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
                await ctx.reply('Отправьте новую фотографию. Старое фото будкт заменено.');
                break;
        }
        return ctx.wizard.next();
    },
    
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

                case 'edit_gender':
                    if (!ctx.callbackQuery || !['pref_male', 'pref_female', 'pref_any'].includes(ctx.callbackQuery.data)) {
                        await ctx.reply('Пожалуйста, выберите пол, используя кнопки выше');
                        return;
                    }
                    const gender = ctx.callbackQuery.data === 'pref_male' ? 'male' : 
                                   ctx.callbackQuery.data === 'pref_female' ? 'female' : 'any';
                    await db.updateUserField(ctx.from.id, 'gender', gender);
                    break;

                case 'edit_preferences':
                    if (!ctx.callbackQuery || !['pref_male', 'pref_female', 'pref_any'].includes(ctx.callbackQuery.data)) {
                        await ctx.reply('Пожалуйста, выберите предпочтения, используя кнопки выше');
                        return;
                    }
                    const preferences = ctx.callbackQuery.data === 'pref_male' ? 'male' : 
                                       ctx.callbackQuery.data === 'pref_female' ? 'female' : 'any';
                    await db.updateUserField(ctx.from.id, 'preferences', preferences);
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
                    if (!ctx.message?.photo) {
                        await ctx.reply('Пожалуйста, отправьте фотографию');
                        return;
                    }
                    
                    const photo = ctx.message.photo[ctx.message.photo.length - 1];
                    if (!validators.photo(photo)) {
                        await ctx.reply('Фото слишком большое. Максимальный размер - 5MB');
                        return;
                    }
                    
                    ctx.wizard.state.photos = [photo.file_id];
                    await db.updateUserPhotos(ctx.from.id, ctx.wizard.state.photos);
                    await ctx.reply('Фотография обновлена!', mainMenu);
                    return ctx.scene.leave();
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

module.exports = editProfileScene; 