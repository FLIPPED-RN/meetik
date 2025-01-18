const commands = require('../bot/commands');

const validators = {
    name: (name) => {
        return typeof name === 'string' && 
               name.trim().length > 0 &&
               name.match(/^[а-яА-ЯёЁa-zA-Z\s]{2,30}$/);
    },
    
    age: (age) => {
        const parsedAge = Number(age);
        return Number.isInteger(parsedAge) && parsedAge >= 14 && parsedAge <= 99;
    },
    
    city: (city) => {
        return typeof city === 'string' && 
               city.trim().length > 0 &&
               city.match(/^[а-яА-ЯёЁa-zA-Z\s-]{2,50}$/);
    },
    
    description: (desc) => {
        return typeof desc === 'string' && 
               desc.length <= 500;
    },
    
    photo: (photo) => {
        const MAX_SIZE = 5 * 1024 * 1024;
        return photo && 
               (!photo.file_size || photo.file_size <= MAX_SIZE);
    }
};

module.exports = validators;