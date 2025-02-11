const { Scenes } = require('telegraf');
const validators = require('../utils/validators');
const { mainMenu, editProfileKeyboard, editPreferencesKeyboard } = require('../utils/keyboards');
const db = require('../database');

const editProfileScene = new Scenes.WizardScene(
    'edit_profile',
    async (ctx) => {
        const user = await db.getUserProfile(ctx.from.id);
        if (!user) {
            await ctx.reply('Профиль не найден');
            return ctx.scene.leave();
        }

        await ctx.reply('Что вы хотите изменить?', editProfileKeyboard);
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.callbackQuery) return;

        const action = ctx.callbackQuery.data;
        console.log('Received action:', action);

        if (action === 'cancel_edit') {
            await ctx.reply('Редактирование отменено', mainMenu);
            return ctx.scene.leave();
        }

        if (action.startsWith('set_preferences_')) {
            try {
                const preference = action.replace('set_preferences_', '');
                
                if (!['male', 'female', 'any'].includes(preference)) {
                    throw new Error(`Invalid preference value: ${preference}`);
                }
                
                await db.updateUserField(ctx.from.id, 'preferences', preference);
                
                const preferenceText = {
                    male: 'парней',
                    female: 'девушек',
                    any: 'все анкеты'
                }[preference];
                
                if (ctx.session) {
                    delete ctx.session.lastProfile;
                }
                
                await ctx.answerCbQuery('Настройки обновлены!');
                await ctx.reply(`✅ Настройки обновлены: теперь вы будете видеть ${preferenceText}`, mainMenu);
                return ctx.scene.leave();
            } catch (error) {
                console.error('Error updating preferences:', error);
                await ctx.answerCbQuery('Произошла ошибка при обновлении настроек');
                await ctx.reply('Произошла ошибка при обновлении настроек', mainMenu);
                return ctx.scene.leave();
            }
        }

        ctx.wizard.state.editField = action;
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