/* ============================================
   API CLIENT FOR BACKEND COMMUNICATION
   ============================================ */

class APIClient {
    constructor() {
        this.baseURL = window.location.origin;
        this.token = localStorage.getItem('luckai_token');
    }

    /**
     * Login user
     */
    async login(username, password) {
        try {
            const response = await fetch(`${this.baseURL}/api/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Login failed');
            }

            this.token = data.token;
            localStorage.setItem('luckai_token', this.token);
            return data;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    /**
     * Logout user
     */
    logout() {
        this.token = null;
        localStorage.removeItem('luckai_token');
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!this.token;
    }

    /**
     * Send a message to the AI
     */
    async sendMessage(message, conversationHistory = [], useWebSearch = true, options = {}) {
        // Determine guest mode from localStorage
        const isGuest = localStorage.getItem('guestMode') === 'true';
        const headers = {
            'Content-Type': 'application/json'
        };

        if (isGuest) {
            // Signal server explicitly that this is a guest request
            headers['x-guest'] = 'true';
        } else {
            if (!this.token) {
                throw new Error('Not authenticated');
            }
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(`${this.baseURL}/api/chat`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    message,
                    useWebSearch,
                    conversationHistory,
                    guest: isGuest,
                    temperature: options.temperature,
                    maxTokens: options.maxTokens,
                    fast: options.fast
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to get response');
            }

            return data;
        } catch (error) {
            console.error('Chat error:', error);
            throw error;
        }
    }

    /**
     * Verify token is still valid
     */
    async verifyToken() {
        if (!this.token) {
            return false;
        }

        try {
            const response = await fetch(`${this.baseURL}/api/verify`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            return response.ok;
        } catch (error) {
            return false;
        }
    }

// Fetch a full answer previously requested with two-phase generation
        async fetchFullAnswer(id) {
            try {
                const response = await fetch(`${this.baseURL}/api/chat/full/${id}`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (!response.ok) return { ready: false };
                return await response.json();
            } catch (e) {
                return { ready: false, error: e.message };
            }
        }
    
    async sendFeedback(messageId, feedback, content = '', prompt = '') {
        const isGuest = localStorage.getItem('guestMode') === 'true';
        const headers = { 'Content-Type': 'application/json' };
        if (isGuest) headers['x-guest'] = 'true';
        else if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
        try {
            const res = await fetch(`${this.baseURL}/api/feedback`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ messageId, feedback, content, prompt })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to send feedback');
            return data;
        } catch (e) {
            console.error('Feedback error:', e);
            throw e;
        }
    }

    // Minimal API surface kept intentionally small for cleanliness
}

// Create global API client instance
const apiClient = new APIClient();
