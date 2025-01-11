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

exports.globalRatingKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🌍 Участвовать в глобальной оценке', callback_data: 'join_global' }],
            [{ text: '📊 Статус текущего раунда', callback_data: 'global_status' }],
            [{ text: '🏆 Последние победители', callback_data: 'global_winners' }]
        ]
    }
};

exports.globalVotingKeyboard = (userId) => ({
    reply_markup: {
        inline_keyboard: [
            Array.from({ length: 5 }, (_, i) => ({
                text: `${i + 1}⭐️`,
                callback_data: `global_vote_${userId}_${i + 1}`
            })),
            Array.from({ length: 5 }, (_, i) => ({
                text: `${i + 6}⭐️`,
                callback_data: `global_vote_${userId}_${i + 6}`
            }))
        ]
    }
});

exports.ratingKeyboard = (userId) => ({
    reply_markup: {
        inline_keyboard: Array.from({ length: 10 }, (_, i) => ([
            { text: `${i + 1}`, callback_data: `rate_profile_${userId}_${i + 1}` }
        ]))
    }
});