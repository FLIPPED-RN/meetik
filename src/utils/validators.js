const validators = {
    name: (name) => {
        return typeof name === 'string' && 
               name.match(/^[а-яА-ЯёЁa-zA-Z\s]{2,30}$/);
    },
    
    age: (age) => {
        const parsedAge = parseInt(age);
        return !isNaN(parsedAge) && parsedAge >= 14 && parsedAge <= 99;
    },
    
    city: (city) => {
        return typeof city === 'string' && 
               city.match(/^[а-яА-ЯёЁa-zA-Z\s-]{2,50}$/);
    },
    
    description: (desc) => {
        return typeof desc === 'string' && 
               desc.length <= 500;
    },
    
    photo: (photo) => {
        return photo && 
               (!photo.file_size || photo.file_size <= 5242880); // 5MB
    }
};

module.exports = validators; 