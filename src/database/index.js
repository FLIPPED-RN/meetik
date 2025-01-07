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
                    last_global_win TIMESTAMP
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
                    is_skip BOOLEAN DEFAULT false
                );

                CREATE TABLE IF NOT EXISTS winners (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT REFERENCES users(user_id),
                    place INTEGER,
                    coins_received INTEGER,
                    round_end_time TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS global_ratings (
                    id SERIAL PRIMARY KEY,
                    from_user_id BIGINT REFERENCES users(user_id),
                    to_user_id BIGINT REFERENCES users(user_id),
                    rating INTEGER CHECK (rating >= 1 AND rating <= 10),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    round_id INTEGER
                );

                CREATE TABLE IF NOT EXISTS global_rounds (
                    id SERIAL PRIMARY KEY,
                    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    registration_end_time TIMESTAMP,
                    rating_end_time TIMESTAMP,
                    voting_end_time TIMESTAMP,
                    is_active BOOLEAN DEFAULT true
                );

                CREATE TABLE IF NOT EXISTS global_votes (
                    id SERIAL PRIMARY KEY,
                    voter_id BIGINT REFERENCES users(user_id),
                    candidate_id BIGINT REFERENCES users(user_id),
                    round_id INTEGER REFERENCES global_rounds(id),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        const { telegramId, name, age, city, gender, preferences, photos, description } = userData;
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                `INSERT INTO users (user_id, name, age, city, gender, preferences, description)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [telegramId, name, age, city, gender, preferences, description]
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
            
            // Удаляем старые фото
            await client.query('DELETE FROM photos WHERE user_id = $1', [userId]);
            
            // Добавляем новые фото
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
            
            // Сохраняем оценку
            await client.query(
                'INSERT INTO ratings (from_user_id, to_user_id, rating) VALUES ($1, $2, $3)',
                [fromUserId, targetId, rating]
            );

            // Обновляем средний рейтинг
            await client.query(`
                UPDATE users 
                SET average_rating = (
                    SELECT AVG(rating)::DECIMAL(3,2)
                    FROM ratings
                    WHERE to_user_id = $1
                    AND created_at >= NOW() - INTERVAL '30 minutes'
                )
                WHERE user_id = $1
            `, [targetId]);

            // Проверяем взаимные высокие оценки
            const mutualRating = await client.query(`
                SELECT r1.rating as rating1, r2.rating as rating2
                FROM ratings r1
                JOIN ratings r2 ON r1.from_user_id = r2.to_user_id 
                    AND r1.to_user_id = r2.from_user_id
                WHERE r1.from_user_id = $1 AND r1.to_user_id = $2
                    AND r1.created_at >= NOW() - INTERVAL '24 hours'
                    AND r2.created_at >= NOW() - INTERVAL '24 hours'
            `, [fromUserId, targetId]);

            await client.query('COMMIT');

            return {
                isMutualHigh: mutualRating.rows.length > 0 && 
                             mutualRating.rows[0].rating1 >= 8 && 
                             mutualRating.rows[0].rating2 >= 8
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    getNextProfile: async (userId) => {
        const result = await pool.query(`
            SELECT u.*, array_agg(p.photo_id) as photos
            FROM users u
            LEFT JOIN photos p ON u.user_id = p.user_id
            WHERE u.user_id != $1
            AND (
                u.last_win_time IS NULL 
                OR u.last_win_time < NOW() - INTERVAL '1 hour'
            )
            AND NOT EXISTS (
                SELECT 1 FROM ratings r
                WHERE r.from_user_id = $1 
                AND r.to_user_id = u.user_id
                AND (r.created_at > NOW() - INTERVAL '1 hour' OR r.is_skip = true)
            )
            GROUP BY u.user_id
            ORDER BY RANDOM()
            LIMIT 1
        `, [userId]);

        return result.rows[0];
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
        const result = await pool.query(`
            SELECT r.*, u.username 
            FROM ratings r
            LEFT JOIN users u ON r.from_user_id = u.user_id
            WHERE r.to_user_id = $1
            AND r.is_skip = false
            ORDER BY r.created_at DESC
            LIMIT 5
        `, [userId]);
        return result.rows;
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

    getProfilesForRating: async (userId) => {
        try {
            const result = await pool.query(`
                SELECT u.* FROM users u
                LEFT JOIN ratings r ON u.user_id = r.to_user_id AND r.from_user_id = $1
                WHERE u.user_id != $1 
                AND r.rating IS NULL
                ORDER BY RANDOM()
                LIMIT 10
            `, [userId]);
            
            return result.rows;
        } catch (error) {
            console.error('Ошибка при получении профилей для оценки:', error);
            throw error;
        }
    },

    joinGlobalRating: async (userId) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Проверяем баланс пользователя
            const user = await client.query('SELECT coins FROM users WHERE user_id = $1', [userId]);
            
            if (!user.rows[0] || user.rows[0].coins < 50) {
                throw new Error('Недостаточно монет для участия! Необходимо 50 монет.');
            }

            // Получаем текущий раунд
            const currentRound = await client.query(`
                SELECT * FROM global_rounds WHERE is_active = true
            `);

            // Если нет активного раунда, создаем новый
            if (!currentRound.rows[0]) {
                const now = new Date();
                const ratingEnd = new Date(now.getTime() + 5 * 60000); // 5 минут на раунд

                await client.query(`
                    INSERT INTO global_rounds 
                    (start_time, rating_end_time, is_active)
                    VALUES ($1, $2, true)
                `, [now, ratingEnd]);
            }

            // Списываем монеты и добавляем участника
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
            SELECT * FROM global_rounds 
            WHERE is_active = true 
            ORDER BY start_time DESC 
            LIMIT 1
        `);
        return result.rows[0]; // Возвращаем null если нет активного раунда
    },

    getGlobalRatingParticipants: async (excludeUserId = null) => {
        const query = `
            SELECT u.*, 
                   array_agg(DISTINCT p.photo_id) as photos,
                   COALESCE(COUNT(DISTINCT gv.voter_id), 0) as votes_count
            FROM users u
            LEFT JOIN photos p ON p.user_id = u.user_id
            LEFT JOIN global_votes gv ON gv.candidate_id = u.user_id
            WHERE u.in_global_rating = true
            ${excludeUserId ? 'AND u.user_id != $1' : ''}
            AND NOT EXISTS (
                SELECT 1 FROM global_votes gv2
                WHERE gv2.voter_id = ${excludeUserId || 0}
                AND gv2.candidate_id = u.user_id
            )
            GROUP BY u.user_id
            ORDER BY votes_count DESC, RANDOM()
        `;

        const result = await pool.query(
            query,
            excludeUserId ? [excludeUserId] : []
        );
        return result.rows;
    },

    saveGlobalVote: async (voterId, candidateId) => {
        const currentRound = await db.getCurrentGlobalRound();
        
        // Проверяем, не голосовал ли уже пользователь за эту анкету
        const existingVote = await pool.query(`
            SELECT 1 FROM global_votes
            WHERE voter_id = $1 AND candidate_id = $2
        `, [voterId, candidateId]);

        if (existingVote.rows.length > 0) {
            throw new Error('Вы уже голосовали за эту анкету');
        }

        await pool.query(`
            INSERT INTO global_votes (voter_id, candidate_id, round_id)
            VALUES ($1, $2, $3)
        `, [voterId, candidateId, currentRound.id]);
    },

    finishGlobalRound: async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Получаем топ-10 участников
            const topParticipants = await client.query(`
                SELECT u.*, COUNT(gv.voter_id) as votes_count
                FROM users u
                LEFT JOIN global_votes gv ON gv.candidate_id = u.user_id
                WHERE u.in_global_rating = true
                GROUP BY u.user_id
                ORDER BY votes_count DESC, RANDOM()
                LIMIT 10
            `);

            // Обновляем статус победителей и начисляем монеты
            for (let i = 0; i < topParticipants.rows.length; i++) {
                const participant = topParticipants.rows[i];
                const coins = i === 0 ? 500 : i === 1 ? 300 : i === 2 ? 100 : 0;

                if (coins > 0) {
                    await client.query(`
                        UPDATE users 
                        SET coins = coins + $1,
                            last_global_win = NOW()
                        WHERE user_id = $2
                    `, [coins, participant.user_id]);
                }
            }

            // Сбрасываем флаги участия и очищаем голоса
            await client.query(`UPDATE users SET in_global_rating = false WHERE in_global_rating = true`);
            await client.query(`DELETE FROM global_votes`);

            await client.query('COMMIT');
            return topParticipants.rows;
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
            
            // Завершаем все активные раунды
            await client.query(`
                UPDATE global_rounds 
                SET is_active = false 
                WHERE is_active = true
            `);

            const now = new Date();
            const registrationEnd = new Date(now.getTime() + 2 * 60000);  // 2 минуты на регистрацию
            const ratingEnd = new Date(now.getTime() + 5 * 60000);       // 5 минут всего

            const result = await client.query(`
                INSERT INTO global_rounds 
                (start_time, registration_end_time, rating_end_time, is_active)
                VALUES ($1, $2, $3, true)
                RETURNING *
            `, [now, registrationEnd, ratingEnd]);

            await client.query('COMMIT');
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    getGlobalRatingParticipantsCount: async () => {
        const result = await pool.query(`
            SELECT COUNT(*) as count 
            FROM users 
            WHERE in_global_rating = true
        `);
        return parseInt(result.rows[0].count);
    },

    getAllUsers: async () => {
        const result = await pool.query('SELECT user_id FROM users');
        return result.rows;
    }
};

module.exports = db; 