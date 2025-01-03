class Config {
    constructor() {
        this.BOT_TOKEN = process.env.BOT_TOKEN;
        this.DB = {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        };
    }
}

module.exports = new Config();