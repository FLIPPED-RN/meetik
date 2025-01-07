exports.mainMenu = {
    reply_markup: {
        keyboard: [
            ['🔍 Начать оценивать', '👑 Лидеры'],
            ['👤 Мой профиль', '💰 Баланс'],
            ['🌍 Глобальный рейтинг', '⭐️ Кто меня оценил']
        ],
        resize_keyboard: true
    }
};

exports.genderKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: 'Мужской ♂️', callback_data: 'gender_male' },
                { text: 'Женский ♀️', callback_data: 'gender_female' }
            ]
        ]
    }
};

exports.preferencesKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: 'Парней ♂️', callback_data: 'pref_male' },
                { text: 'Девушек ♀️', callback_data: 'pref_female' }
            ],
            [{ text: 'Неважно 🤝', callback_data: 'pref_any' }]
        ]
    }
};

exports.editProfileKeyboard = {
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
};