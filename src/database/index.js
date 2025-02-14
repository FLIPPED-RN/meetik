const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(config.DB);

const db = {
    initDb: async () => {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    user_id BIGINT PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    age INTEGER NOT NULL,
                    city VARCHAR(100) NOT NULL,
                    gender VARCHAR(10) NOT NULL,
                    preferences VARCHAR(10) NOT NULL,
                    description TEXT,
                    username VARCHAR(255),
                    coins INTEGER DEFAULT 0,
                    average_rating DECIMAL(4,2) DEFAULT 0,
                    last_win_time TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    in_global_rating BOOLEAN DEFAULT false,
                    last_global_win TIMESTAMP,
                    global_rating_sum INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS global_ratings (
                    id SERIAL PRIMARY KEY,
                    from_user_id BIGINT REFERENCES users(user_id),
                    to_user_id BIGINT REFERENCES users(user_id),
                    rating INTEGER CHECK (rating >= 1 AND rating <= 10),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    round_id INTEGER
                );

                CREATE TABLE IF NOT EXISTS photos (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT REFERENCES users(user_id),
                    photo_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS ratings (
                    id SERIAL PRIMARY KEY,
                    from_user_id BIGINT REFERENCES users(user_id),
                    to_user_id BIGINT REFERENCES users(user_id),
                    rating INTEGER CHECK (rating >= 1 AND rating <= 10),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_skip BOOLEAN DEFAULT false,
                    processed BOOLEAN DEFAULT false
                );

                CREATE TABLE IF NOT EXISTS winners (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT REFERENCES users(user_id),
                    place INTEGER,
                    coins_received INTEGER,
                    round_end_time TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_global_round BOOLEAN DEFAULT false
                );

                CREATE TABLE IF NOT EXISTS global_rounds (
                    id SERIAL PRIMARY KEY,
                    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    registration_end_time TIMESTAMP,
                    rating_end_time TIMESTAMP,
                    final_voting_end_time TIMESTAMP,
                    is_active BOOLEAN DEFAULT true,
                    is_final_voting BOOLEAN DEFAULT false,
                    is_reward_phase BOOLEAN DEFAULT false,
                    reward_end_time TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS global_votes (
                    id SERIAL PRIMARY KEY,
                    voter_id BIGINT REFERENCES users(user_id),
                    candidate_id BIGINT REFERENCES users(user_id),
                    round_id INTEGER REFERENCES global_rounds(id),
                    rating INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS global_rating_stats (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT REFERENCES users(user_id),
                    round_id INTEGER REFERENCES global_rounds(id),
                    total_votes INTEGER DEFAULT 0,
                    total_rating INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (user_id, round_id)
                );
            `);
            console.log('База данных инициализирована');
        } catch (err) {
            console.error('Ошибка при инициализации базы данных:', err);
            throw err;
        }
    },

    getUserProfile: async (userId) => {
        const result = await pool.query(`
            SELECT 
                u.*,
                (
                    SELECT SUM(rating)
                    FROM ratings r
                    WHERE r.to_user_id = u.user_id
                ) as total_rating
            FROM users u
            WHERE u.user_id = $1
        `, [userId]);
        return result.rows[0];
    },

    saveUserProfile: async (userData) => {
        const { telegramId, name, age, city, gender, preferences, photos, description, username } = userData;
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                `INSERT INTO users (user_id, name, age, city, gender, preferences, description, username)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING *`,
                [telegramId, name, age, city, gender, preferences, description, username]
            );

            for (const photoId of photos) {
                await client.query(
                    'INSERT INTO photos (user_id, photo_id) VALUES ($1, $2)',
                    [telegramId, photoId]
                );
            }

            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    updateUserField: async (userId, field, value) => {
        await pool.query(
            `UPDATE users SET ${field} = $1 WHERE user_id = $2`,
            [value, userId]
        );
    },

    updateUserPhotos: async (userId, photoIds) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM photos WHERE user_id = $1', [userId]);
            for (const photoId of photoIds) {
                await client.query(
                    'INSERT INTO photos (user_id, photo_id) VALUES ($1, $2)',
                    [userId, photoId]
                );
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    getUserPhotos: async (userId) => {
        const result = await pool.query(
            'SELECT photo_id FROM photos WHERE user_id = $1',
            [userId]
        );
        return result.rows.map(row => row.photo_id);
    },

    saveRating: async (targetId, fromUserId, rating) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Проверяем, участвует ли целевой пользователь в глобальной оценке
            const targetUser = await client.query(`
                SELECT in_global_rating FROM users WHERE user_id = $1
            `, [targetId]);

            if (targetUser.rows[0].in_global_rating) {
                // Получаем текущий активный раунд
                const currentRound = await client.query(`
                    SELECT id FROM global_rounds 
                    WHERE is_active = true 
                    AND is_final_voting = false
                `);

                if (!currentRound.rows[0]) {
                    throw new Error('Активный раунд не найден');
                }

                // Проверяем, не голосовал ли уже пользователь
                const existingVote = await client.query(`
                    SELECT id FROM global_votes 
                    WHERE voter_id = $1 
                    AND candidate_id = $2
                    AND round_id = $3
                `, [fromUserId, targetId, currentRound.rows[0].id]);

                if (existingVote.rows.length > 0) {
                    throw new Error('Вы уже голосовали за этого участника');
                }

                // Сохраняем голос в глобальном рейтинге
                await client.query(`
                    INSERT INTO global_votes (voter_id, candidate_id, round_id, rating)
                    VALUES ($1, $2, $3, $4)
                `, [fromUserId, targetId, currentRound.rows[0].id, rating]);

                // Обновляем статистику голосов
                await client.query(`
                    INSERT INTO global_rating_stats (user_id, round_id, total_votes, total_rating)
                    VALUES ($1, $2, 1, $3)
                    ON CONFLICT (user_id, round_id)
                    DO UPDATE SET 
                        total_votes = global_rating_stats.total_votes + 1,
                        total_rating = global_rating_stats.total_rating + $3
                `, [targetId, currentRound.rows[0].id, rating]);

                // Проверяем, не пора ли подводить итоги
                const stats = await client.query(`
                    SELECT 
                        COUNT(DISTINCT voter_id) as total_voters,
                        COUNT(DISTINCT candidate_id) as total_candidates
                    FROM global_votes
                    WHERE round_id = $1
                `, [currentRound.rows[0].id]);

                // Если каждый участник получил достаточно голосов, подводим итоги
                if (stats.rows[0].total_voters >= 10) { // Можно настроить минимальное количество голосов
                    await calculateGlobalRatingWinners(client, currentRound.rows[0].id);
                }

            } else {
                // Обычная оценка
                await client.query(`
                    INSERT INTO ratings (from_user_id, to_user_id, rating)
                    VALUES ($1, $2, $3)
                `, [fromUserId, targetId, rating]);

                // Обновляем средний рейтинг пользователя
                await client.query(`
                    UPDATE users 
                    SET average_rating = (
                        SELECT AVG(rating)::numeric(10,2)
                        FROM ratings 
                        WHERE to_user_id = $1
                    )
                    WHERE user_id = $1
                `, [targetId]);

                // Начисляем монеты только за высокие оценки (7-10)
                let coinsToAdd = 0;
                if (rating >= 7) {
                    if (rating === 7) coinsToAdd = 2;
                    else if (rating === 8) coinsToAdd = 3;
                    else if (rating === 9) coinsToAdd = 4;
                    else if (rating === 10) coinsToAdd = 5;

                    await client.query(`
                        UPDATE users 
                        SET coins = COALESCE(coins, 0) + $1 
                        WHERE user_id = $2
                    `, [coinsToAdd, targetId]);

                    // Получаем информацию о пользователе, который поставил оценку
                    const raterInfo = await client.query(`
                        SELECT name, age, city, user_id, username FROM users WHERE user_id = $1
                    `, [fromUserId]);

                    // Получаем фото пользователя
                    const photos = await client.query(`
                        SELECT photo_id FROM photos WHERE user_id = $1
                    `, [fromUserId]);

                    // Возвращаем объект с информацией для уведомления
                    return {
                        shouldNotify: true,
                        targetId,
                        rating,
                        raterInfo: raterInfo.rows[0],
                        coinsAdded: coinsToAdd,
                        photos: photos.rows.map(row => row.photo_id)
                    };
                }
            }

            await client.query('COMMIT');
            return null; // Добавляем явный возврат null для случаев без уведомления
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    calculateGlobalRatingWinners: async (client, roundId) => {
        // Получаем топ-3 участников по среднему рейтингу
        const winners = await client.query(`
            WITH rating_summary AS (
                SELECT 
                    u.user_id,
                    u.name,
                    u.age,
                    u.city,
                    COUNT(gv.rating) as total_votes,
                    ROUND(AVG(gv.rating)::numeric, 2) as average_rating,
                    ROW_NUMBER() OVER (
                        ORDER BY AVG(gv.rating) DESC, COUNT(gv.rating) DESC
                    ) as place
                FROM users u
                JOIN global_votes gv ON gv.candidate_id = u.user_id
                WHERE gv.round_id = $1 AND u.in_global_rating = true
                GROUP BY u.user_id, u.name, u.age, u.city
            )
            SELECT *
            FROM rating_summary
            WHERE place <= 3
            ORDER BY place
        `, [roundId]);

        const notifications = [];
        
        // Начисляем монеты победителям
        for (const winner of winners.rows) {
            let coins = 0;
            let message = '';

            if (winner.place === 1) {
                coins = 500;
                message = '🥇 Поздравляем! Вы заняли 1 место в глобальном рейтинге!';
            } else if (winner.place === 2) {
                coins = 300;
                message = '🥈 Поздравляем! Вы заняли 2 место в глобальном рейтинге!';
            } else if (winner.place === 3) {
                coins = 100;
                message = '🥉 Поздравляем! Вы заняли 3 место в глобальном рейтинге!';
            }

            // Обновляем баланс монет и записываем в историю победителей
            await client.query(`
                UPDATE users 
                SET coins = COALESCE(coins, 0) + $1,
                    last_global_win = NOW(),
                    in_global_rating = false
                WHERE user_id = $2
            `, [coins, winner.user_id]);

            // Записываем в историю победителей
            await client.query(`
                INSERT INTO winners (
                    user_id,
                    place,
                    coins_received,
                    round_end_time,
                    is_global_round,
                    average_rating,
                    total_votes
                ) VALUES ($1, $2, $3, NOW(), true, $4, $5)
            `, [winner.user_id, winner.place, coins, winner.average_rating, winner.total_votes]);

            notifications.push({
                userId: winner.user_id,
                message: `${message}\n💰 Вы получили ${coins} монет!\n⭐️ Ваш средний рейтинг: ${winner.average_rating}\n👥 Количество голосов: ${winner.total_votes}`
            });
        }

        return {
            winners: winners.rows,
            notifications
        };
    },

    getProfilesForRating: async (userId) => {
        const client = await pool.connect();
        try {
            // Получаем актуальные предпочтения пользователя
            const userPrefs = await client.query(`
                SELECT preferences, age 
                FROM users 
                WHERE user_id = $1
            `, [userId]);

            if (!userPrefs.rows[0]) {
                return { rows: [], message: 'Профиль не найден' };
            }

            const userPreferences = userPrefs.rows[0].preferences;
            
            // Формируем условие для пола на основе предпочтений
            const genderCondition = userPreferences === 'any' 
                ? 'TRUE' 
                : 'gender = $2';

            const query = `
                WITH RankedProfiles AS (
                    SELECT DISTINCT ON (u.user_id)
                        u.*,
                        array_agg(p.photo_id) as photos,
                        random() as rand
                    FROM users u
                    LEFT JOIN photos p ON p.user_id = u.user_id
                    WHERE u.user_id != $1
                    AND ${genderCondition}
                    AND NOT EXISTS (
                        SELECT 1 
                        FROM ratings r 
                        WHERE r.to_user_id = u.user_id 
                        AND r.from_user_id = $1
                        AND r.created_at > NOW() - INTERVAL '1 hour'
                    )
                    GROUP BY u.user_id
                )
                SELECT 
                    user_id, name, age, city, gender, 
                    preferences, description, username, 
                    coins, average_rating, last_win_time,
                    created_at, in_global_rating, 
                    last_global_win, global_rating_sum,
                    photos
                FROM RankedProfiles
                ORDER BY rand
                LIMIT 1
            `;

            const params = userPreferences === 'any' 
                ? [userId] 
                : [userId, userPreferences];

            const result = await client.query(query, params);
            return {
                rows: result.rows,
                message: result.rows.length === 0 ? 'Нет доступных анкет для оценки' : null
            };
        } finally {
            client.release();
        }
    },

    getNextProfile: async (userId) => {
        const client = await pool.connect();
        try {
            const user = await client.query(`
                SELECT preferences, age 
                FROM users 
                WHERE user_id = $1`, [userId]);
            
            if (!user.rows[0]) return null;

            const userPreferences = user.rows[0].preferences;
            const userAge = user.rows[0].age;

            let query = `
                WITH already_rated AS (
                    SELECT to_user_id 
                    FROM ratings 
                    WHERE from_user_id = $1
                )
                SELECT 
                    u.*,
                    array_agg(p.photo_id) as photos
                FROM users u
                LEFT JOIN photos p ON u.user_id = p.user_id
                WHERE u.user_id != $1
                AND u.user_id NOT IN (SELECT to_user_id FROM already_rated)
                AND u.age BETWEEN $2 AND $3
            `;

            if (userPreferences === 'male') {
                query += ` AND u.gender = 'male'`;
            } else if (userPreferences === 'female') {
                query += ` AND u.gender = 'female'`;
            }

            query += `
                GROUP BY u.user_id
                ORDER BY RANDOM()
                LIMIT 1`;

            const result = await client.query(query, [
                userId,
                Math.max(14, userAge - 2),
                Math.min(99, userAge + 2)
            ]);

            return result.rows[0];
        } finally {
            client.release();
        }
    },

    getCurrentRoundWinners: async () => {
        const result = await pool.query(`
            SELECT u.*, w.coins_received, w.place
            FROM users u
            LEFT JOIN (
                SELECT DISTINCT ON (user_id)
                    user_id,
                    place,
                    coins_received
                FROM winners
                ORDER BY user_id, created_at DESC
            ) w ON u.user_id = w.user_id
            WHERE u.average_rating > 0
            ORDER BY u.average_rating DESC
            LIMIT 10
        `);
        return result.rows;
    },

    getLastRatings: async (userId) => {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT DISTINCT ON (r.from_user_id)
                    r.*, u.name, u.age, u.city, u.user_id, u.username,
                    array_agg(p.photo_id) as photos
                FROM ratings r
                JOIN users u ON r.from_user_id = u.user_id
                LEFT JOIN photos p ON u.user_id = p.user_id
                WHERE r.to_user_id = $1
                AND r.created_at > NOW() - INTERVAL '24 hours'
                GROUP BY r.id, u.user_id, r.created_at
                ORDER BY r.from_user_id, r.created_at DESC
            `, [userId]);

            return result.rows;
        } finally {
            client.release();
        }
    },

    updateWinners: async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const winners = await client.query(`
                WITH RankedUsers AS (
                    SELECT 
                        u.user_id,
                        u.average_rating,
                        ROW_NUMBER() OVER (ORDER BY u.average_rating DESC) as place
                    FROM users u
                    WHERE (last_win_time IS NULL OR last_win_time < NOW() - INTERVAL '20 seconds')
                    AND u.average_rating > 0
                )
                SELECT 
                    user_id,
                    place,
                    CASE
                        WHEN place = 1 THEN 10
                        WHEN place = 2 THEN 5
                        WHEN place = 3 THEN 1
                        ELSE 0
                    END as coins_won
                FROM RankedUsers
                WHERE place <= 10
            `);

            if (winners.rows.length === 0) {
                await client.query('ROLLBACK');
                return [];
            }

            for (const winner of winners.rows) {
                if (winner.coins_won > 0) {
                    await client.query(`
                        UPDATE users 
                        SET coins = COALESCE(coins, 0) + $1,
                            last_win_time = CURRENT_TIMESTAMP
                        WHERE user_id = $2
                    `, [winner.coins_won, winner.user_id]);

                    await client.query(`
                        INSERT INTO winners (user_id, place, coins_received, round_end_time)
                        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                    `, [winner.user_id, winner.place, winner.coins_won]);
                }
            }

            await client.query('COMMIT');
            return winners.rows;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    joinGlobalRating: async (userId) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const user = await client.query(`
                SELECT coins, last_global_win FROM users WHERE user_id = $1
            `, [userId]);
            
            // Проверяем блокировку после победы
            if (user.rows[0].last_global_win) {
                const timeSinceWin = Date.now() - new Date(user.rows[0].last_global_win).getTime();
                if (timeSinceWin < 2 * 60 * 60 * 1000) { // 2 часа
                    throw new Error('Вы недавно участвовали в глобальном рейтинге');
                }
            }

            if (!user.rows[0] || user.rows[0].coins < 50) {
                throw new Error('Недостаточно монет для участия! Необходимо 50 монет.');
            }

            // Обновляем статус пользователя
            await client.query(`
                UPDATE users 
                SET coins = coins - 50,
                    in_global_rating = true 
                WHERE user_id = $1
            `, [userId]);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    getCurrentGlobalRound: async () => {
        const result = await pool.query(`
            WITH expired_rounds AS (
                UPDATE global_rounds 
                SET is_active = false 
                WHERE is_active = true 
                AND rating_end_time < NOW()
                RETURNING id
            )
            SELECT *,
            CASE 
                WHEN rating_end_time > NOW() THEN 
                    EXTRACT(EPOCH FROM (rating_end_time - NOW()))/60
                ELSE 
                    NULL 
            END as minutes_left,
            CASE
                WHEN final_voting_end_time > NOW() THEN
                    EXTRACT(EPOCH FROM (final_voting_end_time - NOW()))/60
                ELSE
                    NULL
            END as final_voting_minutes_left
            FROM global_rounds 
            WHERE is_active = true 
            ORDER BY start_time DESC 
            LIMIT 1
        `);

        return result.rows[0];
    },

    getGlobalRatingParticipants: async (userId) => {
        const client = await pool.connect();
        try {
            const currentRound = await client.query(`
                SELECT id FROM global_rounds 
                WHERE is_active = true 
                AND is_final_voting = false
            `);

            // Получаем анкеты, исключая те, за которые уже проголосовали
            const profiles = await client.query(`
                WITH all_profiles AS (
                    SELECT 
                        u.*,
                        array_agg(p.photo_id) as photos,
                        u.in_global_rating as is_global,
                        CASE 
                            WHEN u.in_global_rating = true THEN 1
                            ELSE 2
                        END as priority
                    FROM users u
                    LEFT JOIN photos p ON u.user_id = p.user_id
                    WHERE u.user_id != $1
                    AND (
                        -- Для глобальных анкет: проверяем что пользователь не голосовал
                        (u.in_global_rating = true 
                        AND NOT EXISTS (
                            SELECT 1 
                            FROM global_votes gv 
                            WHERE gv.candidate_id = u.user_id 
                            AND gv.voter_id = $1
                            AND gv.round_id = $2
                        ))
                    )
                    GROUP BY u.user_id
                )
                SELECT *
                FROM all_profiles
                WHERE is_global = true  -- Берем только глобальные анкеты
                ORDER BY RANDOM()
                LIMIT 1
            `, [userId, currentRound.rows[0]?.id]);

            if (profiles.rows.length === 0) {
                return [];
            }

            return profiles.rows;
        } finally {
            client.release();
        }
    },

    saveGlobalVote: async (voterId, candidateId, rating) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Получаем текущий активный раунд
            const currentRound = await client.query(`
                SELECT id FROM global_rounds 
                WHERE is_active = true 
                AND is_final_voting = false
            `);

            if (!currentRound.rows[0]) {
                throw new Error('Активный раунд не найден');
            }

            // Проверяем существующий голос
            const existingVote = await client.query(`
                SELECT id FROM global_votes 
                WHERE voter_id = $1 
                AND candidate_id = $2
                AND round_id = $3
            `, [voterId, candidateId, currentRound.rows[0].id]);

            if (existingVote.rows.length > 0) {
                throw new Error('Вы уже голосовали за этого участника');
            }

            // Сохраняем голос
            await client.query(`
                INSERT INTO global_votes (voter_id, candidate_id, round_id, rating)
                VALUES ($1, $2, $3, $4)
            `, [voterId, candidateId, currentRound.rows[0].id, rating]);

            // Проверяем существующую статистику
            const existingStat = await client.query(`
                SELECT id FROM global_rating_stats 
                WHERE user_id = $1 AND round_id = $2
            `, [candidateId, currentRound.rows[0].id]);

            if (existingStat.rows.length > 0) {
                // Обновляем существующую статистику
                await client.query(`
                    UPDATE global_rating_stats 
                    SET total_votes = total_votes + 1,
                        total_rating = total_rating + $3
                    WHERE user_id = $1 AND round_id = $2
                `, [candidateId, currentRound.rows[0].id, rating]);
            } else {
                // Создаем новую запись статистики
                await client.query(`
                    INSERT INTO global_rating_stats (user_id, round_id, total_votes, total_rating)
                    VALUES ($1, $2, 1, $3)
                `, [candidateId, currentRound.rows[0].id, rating]);
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    createGlobalRound: async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Завершаем предыдущий раунд и распределяем награды
            const winners = await db.finishGlobalRound();

            // Создаем новый раунд
            const now = new Date();
            const ratingEndTime = new Date(now.getTime() + 30 * 60 * 1000); // 30 минут

            await client.query(`
                INSERT INTO global_rounds (
                    start_time, 
                    rating_end_time,
                    is_active
                ) VALUES ($1, $2, true)
            `, [now, ratingEndTime]);

            await client.query('COMMIT');
            return winners;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    checkAndUpdateGlobalRound: async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Проверяем текущий активный раунд
            const currentRound = await client.query(`
                SELECT * FROM global_rounds 
                WHERE is_active = true
            `);

            if (!currentRound.rows[0]) {
                // Если нет активного раунда, создаем новый
                console.log('Создание нового раунда...');
                await db.createGlobalRound();
            } else {
                const now = new Date();
                const endTime = new Date(currentRound.rows[0].rating_end_time);
                
                if (now >= endTime) {
                    console.log('Завершение раунда...');
                    // Завершаем текущий раунд и создаем новый
                    await db.createGlobalRound();
                }
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    finishGlobalRound: async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Исправляем SQL запрос
            const participants = await client.query(`
                WITH participant_stats AS (
                    SELECT 
                        u.user_id,
                        u.name,
                        COUNT(gv.rating)::integer as total_votes,
                        COALESCE(AVG(gv.rating)::numeric(10,2), 0) as avg_rating
                    FROM users u
                    INNER JOIN global_votes gv ON gv.candidate_id = u.user_id
                    WHERE u.in_global_rating = true
                    GROUP BY u.user_id, u.name
                    HAVING COUNT(gv.rating) >= 3
                )
                SELECT 
                    user_id,
                    name,
                    total_votes,
                    avg_rating,
                    RANK() OVER (ORDER BY avg_rating DESC, total_votes DESC)::integer as place
                FROM participant_stats
            `);

            const allParticipants = participants.rows;
            const winners = allParticipants.filter(p => p.place <= 3);
            const prizes = [500, 300, 100];
            const notifications = [];

            // Обрабатываем каждого участника
            for (const participant of allParticipants) {
                let message;
                let coins = 0;

                if (participant.place <= 3) {
                    coins = prizes[participant.place - 1];
                    message = `🎉 Поздравляем! Вы заняли ${participant.place} место и получили ${coins} монет!`;
                } else {
                    message = 'К сожалению, вы не попали в топ-3 в этом раунде. Не отчаивайтесь и попробуйте снова! 💪';
                }

                // Обновляем монеты и статус участия
                await client.query(`
                    UPDATE users 
                    SET coins = coins + $2,
                        last_global_win = CASE 
                            WHEN $2 > 0 THEN NOW()
                            ELSE last_global_win
                        END,
                        in_global_rating = false
                    WHERE user_id = $1
                `, [participant.user_id, coins]);

                notifications.push({
                    user_id: participant.user_id,
                    message: message
                });
            }

            await client.query('COMMIT');
            return {
                winners,
                notifications
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    updateUserProfile: async (userId, updates) => {
        const allowedFields = ['name', 'age', 'city', 'description', 'preferences'];
        const validUpdates = {};
        
        // Фильтруем только разрешенные поля
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                validUpdates[field] = updates[field];
            }
        }
        
        if (Object.keys(validUpdates).length === 0) return null;
        
        const setClause = Object.keys(validUpdates)
            .map((key, index) => `${key} = $${index + 2}`)
            .join(', ');
        
        const values = [userId, ...Object.values(validUpdates)];
        
        const result = await pool.query(`
            UPDATE users 
            SET ${setClause}
            WHERE user_id = $1
            RETURNING *
        `, values);
        
        return result.rows[0];
    },
}

module.exports = db;