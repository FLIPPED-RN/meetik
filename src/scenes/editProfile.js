const { Scenes } = require('telegraf');
const validators = require('../utils/validators');
const { mainMenu, editProfileKeyboard } = require('../utils/keyboards');
const db = require('../database');

const editProfileScene = new Scenes.WizardScene(
    'edit_profile',
    // Шаг 1: Показ текущего профиля и выбор что редактировать
    async (ctx) => {
        const user = await db.getUserProfile(ctx.from.id);
        if (!user) {
            await ctx.reply('Профиль не найден');
            return ctx.scene.leave();
        }

        await ctx.reply('Что вы хотите изменить?', editProfileKeyboard);
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
                    await db.updateUserPhotos(ctx.from.id, ctx.wizard.state.photos);
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