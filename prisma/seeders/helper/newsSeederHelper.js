export const getRandomNewsImageUrl = () => {
    const queries = ["news", "community", "environment", "event", "charity"];
    const query = queries[Math.floor(Math.random() * queries.length)];
    // Dummy image, bisa diganti dengan API Unsplash/Pexels jika punya API key
    return `https://dummyimage.com/600x400/000/fff&text=${encodeURIComponent(query)}`;
};