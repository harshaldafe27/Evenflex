import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1',
    withCredentials: true,
});

// Attach access token
api.interceptors.request.use((config) => {
    const token = window.__accessToken__;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

// Refresh on 401, swallow background 403s
let refreshing = false;
let queue = [];

// Routes that are role-restricted and should fail silently for other roles
const SILENT_403_PATTERNS = [
    /\/approvals/,
    /\/certificates/,
];

api.interceptors.response.use(
    (res) => res,
    async (err) => {
        const original = err.config;
        const status = err.response && err.response.status;
        const url = (original && original.url) || '';

        // Silently ignore 403s on role-restricted background GET queries only
        if (status === 403 && original && original.method === 'get' && SILENT_403_PATTERNS.some((p) => p.test(url))) {
            return Promise.reject(err);
        }

        if (status === 401 && !original._retry) {
            if (refreshing) {
                return new Promise((resolve, reject) =>
                    queue.push({
                        resolve,
                        reject
                    })
                ).then(() => api(original));
            }
            original._retry = true;
            refreshing = true;
            try {
                const {
                    data
                } = await axios.post(
                    `${api.defaults.baseURL}/auth/refresh`, {}, {
                        withCredentials: true
                    }
                );
                window.__accessToken__ = data.data.accessToken;
                queue.forEach(({
                    resolve
                }) => resolve());
                queue = [];
                return api(original);
            } catch (_) {
                queue.forEach(({
                    reject
                }) => reject());
                queue = [];
                window.__accessToken__ = null;
                window.location.href = '/login';
            } finally {
                refreshing = false;
            }
        }
        return Promise.reject(err);
    }
);

export default api;