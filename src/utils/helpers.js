exports.formatDate = (date) => {
    const d = new Date(date);
    return d.toLocaleString('ru-RU', { 
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

exports.getTimeUntilNextRating = (lastWinTime) => {
    const nextAvailableTime = new Date(lastWinTime);
    nextAvailableTime.setHours(nextAvailableTime.getHours() + 2);
    
    const now = new Date();
    const diff = nextAvailableTime - now;
    
    if (diff <= 0) return 'сейчас';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours}ч ${minutes}м`;
}; 