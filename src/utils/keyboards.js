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
            [{ text: '📝 Изменить имя', callback_data: 'edit_name' }],
            [{ text: '🎂 Изменить возраст', callback_data: 'edit_age' }],
            [{ text: '🌆 Изменить город', callback_data: 'edit_city' }],
            [{ text: '📄 Изменить описание', callback_data: 'edit_description' }],
            [{ text: '🔄 Изменить предпочтения', callback_data: 'edit_preferences' }],
            [{ text: '🔙 Назад', callback_data: 'back_to_profile' }]
        ]
    }
};

exports.editPreferencesKeyboard = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '👩 Девушки', callback_data: 'set_preferences_female' },
                { text: '👨 Парни', callback_data: 'set_preferences_male' }
            ],
            [{ text: '🤝 Все анкеты', callback_data: 'set_preferences_any' }]
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
        inline_keyboard: [
            [
                { text: '1️⃣', callback_data: `rate_${userId}_1` },
                { text: '2️⃣', callback_data: `rate_${userId}_2` },
                { text: '3️⃣', callback_data: `rate_${userId}_3` },
                { text: '4️⃣', callback_data: `rate_${userId}_4` },
                { text: '5️⃣', callback_data: `rate_${userId}_5` }
            ],
            [
                { text: '6️⃣', callback_data: `rate_${userId}_6` },
                { text: '7️⃣', callback_data: `rate_${userId}_7` },
                { text: '8️⃣', callback_data: `rate_${userId}_8` },
                { text: '9️⃣', callback_data: `rate_${userId}_9` },
                { text: '🔟', callback_data: `rate_${userId}_10` }
            ]
        ]
    }
});

exports.profileNavigationKeyboard = (currentIndex, totalProfiles) => ({
    inline_keyboard: [[
        { text: '⬅️', callback_data: `rating_prev_${currentIndex}` },
        { text: `${currentIndex + 1}/${totalProfiles}`, callback_data: 'rating_count' },
        { text: '➡️', callback_data: `rating_next_${currentIndex}` }
    ]]
});

exports.editProfileButton = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '✏️ Редактировать профиль', callback_data: 'edit_profile' }
            ]
        ]
    }
};

exports.viewProfileButton = {
    reply_markup: {
        inline_keyboard: [[{ text: 'Посмотреть еще', callback_data: `next_profile` }]]
    }
};