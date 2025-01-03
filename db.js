const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.DB);

// Инициализация таблиц
const initDb = async () => {
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
                coins INTEGER DEFAULT 0,
                average_rating DECIMAL(4,2) DEFAULT 0,
                last_win_time TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS winners (
                id SERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(user_id),
                place INTEGER,
                coins_received INTEGER,
                round_end_time TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('База данных инициализирована');
    } catch (err) {
        console.error('Ошибка при инициализации базы данных:', err);
    }
};

const updateWinners = async () => {
    try {
        await pool.query('BEGIN');

        // Получаем топ-10 пользователей по среднему рейтингу за последние 10 секунд
        const winners = await pool.query(`
            WITH RankedUsers AS (
                SELECT 
                    u.user_id,
                    u.average_rating,
                    ROW_NUMBER() OVER (ORDER BY 
                        (SELECT AVG(rating) FROM ratings 
                         WHERE to_user_id = u.user_id 
                         AND created_at >= NOW() - INTERVAL '10 seconds') DESC
                    ) as place
                FROM users u
                WHERE (last_win_time IS NULL OR last_win_time < NOW() - INTERVAL '20 seconds')
                AND EXISTS (
                    SELECT 1 FROM ratings r 
                    WHERE r.to_user_id = u.user_id 
                    AND r.created_at >= NOW() - INTERVAL '10 seconds'
                )
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

        // Обновляем монеты и время последней победы
        for (const winner of winners.rows) {
            if (winner.coins_won > 0) {
                await pool.query(`
                    UPDATE users 
                    SET coins = COALESCE(coins, 0) + $1,
                        last_win_time = CURRENT_TIMESTAMP
                    WHERE user_id = $2
                `, [winner.coins_won, winner.user_id]);

                await pool.query(`
                    INSERT INTO winners (user_id, place, coins_received, round_end_time)
                    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                `, [winner.user_id, winner.place, winner.coins_won]);
            }
        }

        await pool.query('COMMIT');
        return winners.rows;
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Ошибка при обновлении победителей:', error);
        throw error;
    }
};

const db = {
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

    createUser: async (userId, name, age, city, gender, preferences) => {
        const result = await pool.query(
            'INSERT INTO users (user_id, name, age, city, gender, preferences) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [userId, name, age, city, gender, preferences]
        );
        return result.rows[0];
    },

    addPhoto: async (userId, photoId) => {
        await pool.query(
            'INSERT INTO photos (user_id, photo_id) VALUES ($1, $2)',
            [userId, photoId]
        );
    },

    addRating: async (fromUserId, toUserId, rating) => {
        await pool.query(
            'INSERT INTO ratings (from_user_id, to_user_id, rating) VALUES ($1, $2, $3)',
            [fromUserId, toUserId, rating]
        );
    },

    saveUserProfile: async (userData) => {
        const { telegramId, name, age, city, gender, preferences, photos, description } = userData;
        
        const result = await pool.query(
            `INSERT INTO users (user_id, name, age, city, gender, preferences, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [telegramId, name, age, city, gender, preferences, description]
        );

        // Добавляем фотографии
        for (const photoId of photos) {
            await pool.query(
                'INSERT INTO photos (user_id, photo_id) VALUES ($1, $2)',
                [telegramId, photoId]
            );
        }

        return result.rows[0];
    },

    getUserPhotos: async (userId) => {
        const result = await pool.query('SELECT photo_id FROM photos WHERE user_id = $1', [userId]);
        return result.rows.map(row => row.photo_id);
    },

    getLeaderboard: async () => {
        const result = await pool.query(`
            SELECT u.name, u.coins, COUNT(w.id) as wins
            FROM users u
            LEFT JOIN winners w ON u.user_id = w.user_id
            GROUP BY u.user_id, u.name, u.coins
            ORDER BY wins DESC
            LIMIT 10
        `);
        return result.rows;
    },

    updateAverageRating: async (userId) => {
        const result = await pool.query(`
            UPDATE users 
            SET average_rating = (
                SELECT AVG(rating)::DECIMAL(3,2)
                FROM ratings
                WHERE to_user_id = $1
                AND created_at >= NOW() - INTERVAL '30 minutes'
            )
            WHERE user_id = $1
            RETURNING average_rating
        `, [userId]);
        return result.rows[0];
    },

    getAvailableProfiles: async (userId, gender, preferences) => {
        const result = await pool.query(`
            SELECT u.*, array_agg(p.photo_id) as photos
            FROM users u
            LEFT JOIN photos p ON u.user_id = p.user_id
            WHERE u.user_id != $1
            AND (
                CASE 
                    WHEN $3 = 'неважно' THEN true
                    ELSE u.gender = $3
                END
            )
            AND u.last_win_time < NOW() - INTERVAL '2 hours'
            GROUP BY u.user_id
        `, [userId, gender, preferences]);
        return result.rows;
    },

    getProfilesForRating: async (userId) => {
        const user = await pool.query('SELECT gender, preferences FROM users WHERE user_id = $1', [userId]);
        if (!user.rows[0]) return [];

        const result = await pool.query(`
            SELECT u.*, array_agg(p.photo_id) as photos
            FROM users u
            LEFT JOIN photos p ON u.user_id = p.user_id
            WHERE u.user_id != $1
            AND (
                CASE 
                    WHEN $2 = 'any' THEN true
                    ELSE u.gender = $2
                END
            )
            AND (
                u.last_win_time IS NULL 
                OR u.last_win_time < NOW() - INTERVAL '20 seconds'
            )
            AND NOT EXISTS (
                SELECT 1 FROM ratings r
                WHERE r.from_user_id = $1 
                AND r.to_user_id = u.user_id
                AND r.created_at > NOW() - INTERVAL '20 seconds'
            )
            GROUP BY u.user_id
            LIMIT 10
        `, [userId, user.rows[0].preferences]);

        return result.rows;
    },

    getNextProfile: async (userId) => {
        const result = await pool.query(`
            SELECT u.*, array_agg(p.photo_id) as photos
            FROM users u
            LEFT JOIN photos p ON u.user_id = p.user_id
            WHERE u.user_id != $1
            AND (
                u.last_win_time IS NULL 
                OR u.last_win_time < NOW() - INTERVAL '20 seconds'
            )
            AND NOT EXISTS (
                SELECT 1 FROM ratings r
                WHERE r.from_user_id = $1 
                AND r.to_user_id = u.user_id
                AND r.created_at > NOW() - INTERVAL '20 seconds'
            )
            GROUP BY u.user_id
            LIMIT 1
        `, [userId]);

        return result.rows[0];
    },

    saveRating: async (targetId, fromUserId, rating) => {
        try {
            await pool.query('BEGIN');
            
            // Сохраняем оценку
            await pool.query(
                'INSERT INTO ratings (from_user_id, to_user_id, rating) VALUES ($1, $2, $3)',
                [fromUserId, targetId, rating]
            );
            
            // Обновляем средний рейтинг
            const ratingResult = await pool.query(`
                SELECT ROUND(AVG(rating)::numeric, 2) as avg_rating,
                       COUNT(*) as total_ratings
                FROM ratings
                WHERE to_user_id = $1
            `, [targetId]);
            
            const avgRating = ratingResult.rows[0].avg_rating;
            
            // Обновляем пользователя
            await pool.query(`
                UPDATE users 
                SET average_rating = $1
                WHERE user_id = $2
            `, [avgRating, targetId]);
            
            // Если оценка высокая (7-10), начисляем монеты
            if (rating >= 7) {
                const coinsToAdd = rating - 6; // 7=1 монета, 8=2 монеты и т.д.
                await pool.query(`
                    UPDATE users 
                    SET coins = COALESCE(coins, 0) + $1
                    WHERE user_id = $2
                `, [coinsToAdd, targetId]);
            }
            
            await pool.query('COMMIT');
        } catch (error) {
            await pool.query('ROLLBACK');
            throw error;
        }
    },

    updateWinners,
    
    getCurrentRoundWinners: async () => {
        const result = await pool.query(`
            SELECT 
                u.name,
                u.average_rating,
                u.coins,
                w.place,
                w.coins_received,
                (
                    SELECT SUM(rating)
                    FROM ratings r
                    WHERE r.to_user_id = u.user_id
                ) as total_rating
            FROM users u
            LEFT JOIN (
                SELECT *
                FROM winners
                WHERE round_end_time = (
                    SELECT MAX(round_end_time)
                    FROM winners
                )
            ) w ON u.user_id = w.user_id
            WHERE u.average_rating > 0
            ORDER BY u.average_rating DESC
            LIMIT 10
        `);
        return result.rows;
    },

    getWinsCount: async (userId) => {
        const result = await pool.query(
            'SELECT COUNT(*) as wins FROM winners WHERE user_id = $1',
            [userId]
        );
        return parseInt(result.rows[0].wins) || 0;
    }
};


initDb();

module.exports = db; 