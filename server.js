const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const { LocalGGUFRunner } = require('./gguf-runner');
const fs = require('fs');
const os = require('os');

// In-memory store for background full-generation results (fullId -> { ready, answer, startedAt, finishedAt })
const fullResponses = new Map();

// Logging utility
const log = (level, message, data = '') => {
    const timestamp = new Date().toISOString();
    const logMsg = data ? `${timestamp} [${level}] ${message} ${data}` : `${timestamp} [${level}] ${message}`;
    console.log(logMsg);
};

log('INFO', 'LuckAI Server Initializing...');

/* ============================================
   NEURAL NETWORK / TRANSFORMER MODEL (LuckAI)
   ============================================ */

/**
 * Mini Transformer-based Language Model
 * 
 * Architecture inspired by DeepSeek-R1 and modern LLMs:
 * - Token embedding layer (vocabulary -> vector space)
 * - Multiple transformer blocks with multi-head self-attention
 * - Feed-forward networks (FFN) in each block
 * - Layer normalization for stable training
 * - Autoregressive generation with softmax sampling
 */
class LuckModel {
    constructor() {
        // Model configuration
        this.vocab_size = 10000;  // Token vocabulary
        this.embedding_dim = 256; // Embedding dimension
        this.num_layers = 4;      // Number of transformer blocks
        this.num_heads = 8;       // Multi-head attention heads
        this.hidden_dim = 512;    // FFN hidden dimension
        this.max_sequence = 2048; // Max sequence length
        this.temperature = 0.7;   // Sampling temperature

        // Knowledge base for context-aware responses
        this.knowledge_base = this.initializeKnowledgeBase();
        
        // Initialize conversation memory
        this.conversationMemory = new Map();

        console.log('[LuckAI Model] Initialized with transformer architecture');
        console.log(`  - Embedding dimension: ${this.embedding_dim}`);
        console.log(`  - Number of layers: ${this.num_layers}`);
        console.log(`  - Attention heads: ${this.num_heads}`);
    }

    /**
     * Initialize knowledge base with general knowledge
     * In a real implementation, this would be loaded from pretrained weights
     */
    initializeKnowledgeBase() {
        return {
            facts: {
                'france': 'France is a country in Western Europe with the capital Paris.',
                'paris': 'Paris is the capital of France, known for the Eiffel Tower.',
                'ai': 'Artificial Intelligence is the simulation of human intelligence in machines.',
                'deepseek': 'DeepSeek is an open-source AI model known for reasoning capabilities.',
                'transformer': 'Transformer is a neural network architecture based on self-attention mechanisms.',
            },
            capabilities: [
                'I can answer questions in French and English',
                'I can explain complex concepts',
                'I can summarize information',
                'I can analyze and compare ideas',
                'I can provide structured answers',
                'I can access web information when enabled'
            ]
        };
    }

    /**
     * Tokenize input text
     * In a real model, this would use a proper tokenizer
     */
    tokenize(text) {
        // Simple tokenization: split by whitespace and punctuation
        const tokens = text.toLowerCase()
            .split(/[\s\.,!?;:()[\]{}]/g)
            .filter(t => t.length > 0);
        
        // For demonstration, just return token indices
        return tokens.map((token, idx) => ({
            word: token,
            id: this.hashToken(token) % this.vocab_size
        }));
    }

    /**
     * Simple hash function for tokens
     */
    hashToken(token) {
        let hash = 0;
        for (let i = 0; i < token.length; i++) {
            const char = token.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    /**
     * Multi-head self-attention computation
     * This simulates the attention mechanism in transformers
     */
    selfAttention(queries, keys, values, numHeads) {
        const seqLen = queries.length;
        const headDim = Math.floor(queries[0].length / numHeads);
        
        let output = [];

        // For each position, compute attention weights
        for (let i = 0; i < seqLen; i++) {
            let attended = new Array(queries[0].length).fill(0);
            
            // Compute attention with all other positions
            let weights = [];
            let weightSum = 0;

            for (let j = 0; j < seqLen; j++) {
                // Compute similarity (simplified dot product)
                let sim = 0;
                for (let k = 0; k < Math.min(queries[i].length, keys[j].length); k++) {
                    sim += queries[i][k] * keys[j][k];
                }
                
                // Apply softmax (simplified with temperature)
                let weight = Math.exp(sim / this.temperature);
                weights.push(weight);
                weightSum += weight;
            }

            // Normalize weights
            weights = weights.map(w => w / weightSum);

            // Apply weighted attention to values
            for (let j = 0; j < seqLen; j++) {
                for (let k = 0; k < values[j].length; k++) {
                    attended[k] += weights[j] * values[j][k];
                }
            }

            output.push(attended);
        }

        return output;
    }

    /**
     * Feed-forward network in transformer block
     * Two linear layers with ReLU activation
     */
    feedForward(x) {
        // Hidden layer with ReLU
        let hidden = x.map(val => Math.max(0, val * 0.5 + 0.3)); // Simple ReLU
        
        // Output layer
        let output = hidden.map(val => val * 0.8 + 0.1);
        
        return output;
    }

    /**
     * Generate response text from input
     * This is the core inference function
     */
    generateResponse(prompt, webContext = null, language = 'auto') {
        // Detect language
        if (language === 'auto') {
            language = this.detectLanguage(prompt);
        }

        // Build context for response
        let context = this.buildContext(prompt, webContext, language);

        // Generate response tokens
        let response = '';
        let currentContext = context;
        let maxTokens = 200; // Max response length

        for (let tokenIdx = 0; tokenIdx < maxTokens; tokenIdx++) {
            // Predict next token based on context and transformer layers
            let nextToken = this.predictNextToken(currentContext, language);
            
            if (!nextToken || nextToken === '[END]') {
                break;
            }

            response += nextToken + ' ';
            
            // Update context with generated token
            currentContext += nextToken + ' ';
            
            // Keep context size manageable
            if (currentContext.length > 1000) {
                currentContext = currentContext.slice(-500);
            }
        }

        return response.trim();
    }

    /**
     * Detect language of input (FR or EN)
     */
    detectLanguage(text) {
        const lowerText = text.toLowerCase();
        
        // French indicators
        const frenchWords = ['bonjour', 'ça', 'très', 'pourquoi', 'comment', 'voici', 'merci', 'oui', 'non'];
        const frenchCount = frenchWords.filter(w => lowerText.includes(w)).length;

        // English indicators  
        const englishWords = ['hello', 'thank', 'please', 'what', 'why', 'how', 'yes', 'no', 'the', 'this'];
        const englishCount = englishWords.filter(w => lowerText.includes(w)).length;

        return frenchCount > englishCount ? 'fr' : 'en';
    }

    /**
     * Build context for response generation
     */
    buildContext(prompt, webContext, language) {
        let context = '';

        // Add system role
        const role = language === 'fr' 
            ? 'Je suis LuckAI, un assistant IA avancé basé sur une architecture transformer.'
            : 'I am LuckAI, an advanced AI assistant based on transformer architecture.';
        
        context += role + '\n\n';

        // Add web context if available
        if (webContext) {
            context += (language === 'fr' ? 'Informations du web:\n' : 'Web information:\n');
            context += webContext + '\n\n';
        }

        // Add user query
        context += (language === 'fr' ? 'Question: ' : 'Question: ') + prompt + '\n';

        return context;
    }

    /**
     * Predict next token using neural computation
     * Simulates the output layer of a transformer model
     */
    predictNextToken(context, language) {
        // Tokenize context for attention computation
        const tokens = this.tokenize(context);
        
        if (tokens.length === 0) {
            return null;
        }

        // Create embeddings (simplified)
        let embeddings = tokens.map((t, idx) => {
            // Create a pseudo-embedding based on token position and value
            let embedding = [];
            for (let i = 0; i < this.embedding_dim; i++) {
                embedding.push(Math.sin(t.id + i) * Math.cos(idx));
            }
            return embedding;
        });

        // Apply self-attention across the sequence
        let attended = this.selfAttention(embeddings, embeddings, embeddings, this.num_heads);

        // Apply feed-forward transformation
        let transformed = attended[attended.length - 1].map(v => 
            this.feedForward([v])[0]
        );

        // Compute logits for next token prediction
        let logits = [];
        for (let i = 0; i < 100; i++) { // Consider top 100 tokens
            let logit = transformed[i % transformed.length] + Math.random() * 0.1;
            logits.push({ score: logit, tokenId: i });
        }

        // Sort by score and apply temperature
        logits.sort((a, b) => b.score - a.score);
        
        // Sample next token (with temperature)
        let topK = logits.slice(0, 10);
        let weights = topK.map(l => Math.exp(l.score / this.temperature));
        let totalWeight = weights.reduce((a, b) => a + b, 1);
        weights = weights.map(w => w / totalWeight);

        // Pick a token from distribution
        let rand = Math.random();
        let cumSum = 0;
        for (let i = 0; i < topK.length; i++) {
            cumSum += weights[i];
            if (rand < cumSum) {
                return this.tokenIdToWord(topK[i].tokenId, language);
            }
        }

        return this.tokenIdToWord(topK[0].tokenId, language);
    }

    /**
     * Convert token ID to word
     */
    tokenIdToWord(tokenId, language) {
        // Common response words
        const words = {
            en: [
                'The', 'is', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at',
                'this', 'that', 'these', 'those', 'which', 'who', 'what', 'where', 'when', 'why',
                'example', 'include', 'such', 'like', 'different', 'important', 'also', 'can', 'be', 'have',
                'understand', 'know', 'think', 'believe', 'provide', 'offer', 'show', 'explain', 'help', 'support',
                'technology', 'artificial', 'intelligence', 'learning', 'data', 'model', 'system', 'process', 'method', 'way'
            ],
            fr: [
                'Le', 'La', 'Les', 'Un', 'Une', 'Des', 'Est', 'Sont', 'Et', 'Ou',
                'Mais', 'Dans', 'Sur', 'Par', 'Pour', 'À', 'De', 'Avec', 'Sans', 'Selon',
                'Ce', 'Cet', 'Cette', 'Ces', 'Celui', 'Celle', 'Ceux', 'Celles', 'Quel', 'Quelle',
                'Quels', 'Quelles', 'Qui', 'Quoi', 'Où', 'Quand', 'Pourquoi', 'Comment', 'Combien', 'Si',
                'Peut', 'Pouvez', 'Dois', 'Doit', 'Devez', 'Faire', 'Fait', 'Faites', 'Avoir', 'Avez'
            ]
        };

        const wordList = words[language] || words['en'];
        return wordList[tokenId % wordList.length] || 'response';
    }

    /**
     * Process user input and generate response
     * Main method called by the API
     */
    async processQuery(userMessage, conversationHistory = [], webContext = null) {
        // This is a placeholder for actual model inference logic.
        // For demonstration, just echo the user message.
        return {
            response: `Echo: ${userMessage}`,
            language: 'en',
            model: 'LuckModel',
            stats: {}
        };
    }

    /**
     * Parse DuckDuckGo HTML search results
     */
    parseResults(data) {
        if (!data.web || data.web.results.length === 0) {
            return null;
        }

        const results = data.web.results.slice(0, 3).map(result => ({
            title: result.title,
            url: result.url,
            description: result.description,
            snippet: result.snippet
        }));

        return {
            results: results,
            summary: this.summarizeResults(results)
        };
    }

    /**
     * Summarize search results into context
     */
    summarizeResults(results) {
        let summary = 'Recent web information:\n';
        results.forEach((result, idx) => {
            summary += `\n${idx + 1}. ${result.title}\n`;
            summary += `   ${result.description || result.snippet}\n`;
        });
        return summary;
    }
}

/* ============================================
   EXPRESS SERVER SETUP
   ============================================ */

log('INFO', 'Setting up Express server...');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'luckai_secret_key_2025';

log('INFO', 'Port:', PORT);
log('INFO', 'JWT Secret configured:', JWT_SECRET ? 'Yes' : 'No');

// Middleware
log('INFO', 'Initializing middleware...');
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname)));

// Initialize services
log('INFO', 'Initializing DuckDuckGo search client...');

// Ensure a fetch function is available
let _fetchFn = globalThis.fetch;
if (!_fetchFn) {
    try {
        const nodeFetch = require('node-fetch');
        _fetchFn = nodeFetch && nodeFetch.default ? nodeFetch.default : nodeFetch;
    } catch (e) {
        _fetchFn = null;
    }
}

class DuckDuckGoClient {
    constructor() {
        // DuckDuckGo HTML parsing does not require an API key
    }

    async _duckDuckGoSearch(query) {
        if (!_fetchFn) return null;
        try {
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            const headers = { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; LuckAI/1.0)' };
            const res = await _fetchFn(url, { headers });
            if (!res || !res.ok) {
                log('WARN', 'DuckDuckGo HTML search failed, status:', res && res.status);
                return null;
            }
            const html = await res.text();
            // Parse simple anchor-based results
            const parsed = [];
            const anchorRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/ig;
            let m;
            while ((m = anchorRe.exec(html)) && parsed.length < 6) {
                const url = m[1];
                const title = m[2].replace(/<[^>]+>/g, '').trim();
                // Try to find a nearby snippet
                const snippetRe = new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]{0,200}?<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\\s\\S]*?)<\\/div>', 'i');
                let snippet = '';
                const sm = snippetRe.exec(html);
                if (sm && sm[1]) snippet = sm[1].replace(/<[^>]+>/g, '').trim();
                parsed.push({ title, url, description: snippet, snippet });
            }
            const summary = parsed.length ? parsed.map((r, i) => `${i + 1}. ${r.title}\n   ${r.description || ''}`).join('\n') : '';
            return { results: parsed, summary };
        } catch (e) {
            log('ERROR', 'DuckDuckGo search error:', e && e.message ? e.message : e);
            return null;
        }
    }

    async search(query) {
        if (!query || !query.trim()) return null;
        if (!_fetchFn) {
            log('WARN', 'Fetch unavailable, cannot perform search');
            return null;
        }

        // Using DuckDuckGo HTML parsing only (no Brave integration)
        const ddg = await this._duckDuckGoSearch(query);
        if (ddg) return Object.assign(ddg, { provider: 'duckduckgo' });
        return ddg;
    }
}

const searchClient = new DuckDuckGoClient();

// Debug route to test search provider availability
app.get('/api/search/test', async (req, res) => {
    const q = req.query.q || req.query.query;
    if (!q || typeof q !== 'string') return res.status(400).json({ ok: false, message: 'Missing query parameter q' });
    try {
        const r = await searchClient.search(q);
        if (!r) return res.status(500).json({ ok: false, message: 'Search failed' });
        res.json({ ok: true, provider: r.provider || 'unknown', results: r.results || [], summary: r.summary || '' });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});
// Initialize Local GGUF runner (no external Ollama needed)
log('INFO', 'Initializing Local GGUF runner...');
const localRunner = new LocalGGUFRunner({
    modelPath: process.env.LUCKAI_GGUF_PATH,
    contextSize: Number(process.env.LUCKAI_CTX || 4096),
    temperature: 0.7,
    maxTokens: Number(process.env.LUCKAI_MAX_TOKENS || 4096)
});
log('INFO', 'GGUF Path:', process.env.LUCKAI_GGUF_PATH || 'Auto-detect');
log('INFO', 'Context Size:', process.env.LUCKAI_CTX || 4096);

// Utility: prepare model chunks by splitting very large sha256 blobs into parts so they can be stored in Git
async function prepareModelChunks() {
    try {
        const { spawnSync } = require('child_process');
        const script = path.join(__dirname, 'scripts', 'split-gguf.js');
        const candidates = [
            path.join(__dirname, '.ollama'),
            path.join(__dirname, '.ollama', 'blobs'),
            'D:\\usb\\LuckAI\\.ollama',
            path.join(process.cwd(), '.ollama')
        ];

        const seen = new Set();
        const threshold = Number(process.env.LUCKAI_CHUNK_THRESHOLD_MB || 25) * 1024 * 1024;

        for (const baseDir of candidates) {
            try {
                if (!baseDir || !fs.existsSync(baseDir)) continue;
                const entries = fs.readdirSync(baseDir, { withFileTypes: true });
                for (const e of entries) {
                    if (!e.isFile()) continue;
                    const name = e.name;
                    // Only consider top-level sha256- blobs (not already chunk parts like .part001)
                    const m = name.match(/^sha256-[a-f0-9]{64}$/i);
                    if (!m) continue;
                    const full = path.join(baseDir, name);
                    if (seen.has(full)) continue;
                    seen.add(full);
                    const stat = fs.statSync(full);
                    if (stat.size <= threshold) continue; // not too big

                    // Check whether parts already exist
                    const partsExist = fs.readdirSync(baseDir).some(n => n.toLowerCase().startsWith(name.toLowerCase() + '.part'));
                    if (partsExist) {
                        log('INFO', `Chunk parts already present for ${name} in ${baseDir}; skipping split.`);
                        continue;
                    }

                    // If split script is missing, skip
                    if (!fs.existsSync(script)) {
                        log('WARN', 'Split script not found:', script);
                        continue;
                    }

                    log('INFO', `Large blob detected (${(stat.size/1024/1024).toFixed(2)}MB): ${full}. Running splitter...`);
                    try {
                        const res = spawnSync(process.execPath, [script, full, String(Number(process.env.LUCKAI_CHUNK_THRESHOLD_MB || 25))], { cwd: __dirname, encoding: 'utf8', stdio: 'pipe' });
                        if (res.stdout && res.stdout.trim()) log('INFO', 'Splitter stdout:', res.stdout.trim());
                        if (res.stderr && res.stderr.trim()) log('WARN', 'Splitter stderr:', res.stderr.trim());
                        if (res.status !== 0) log('WARN', `Splitter exited with code ${res.status} for ${full}`);
                        else log('INFO', `Splitter completed for ${full}`);
                    } catch (e) {
                        log('ERROR', `Failed to run splitter on ${full}:`, e && e.message ? e.message : e);
                    }
                }
            } catch (e) { /* ignore */ }
        }
    } catch (e) {
        log('ERROR', 'prepareModelChunks failed:', e && e.message ? e.message : e);
    }
}

// Check Local GGUF availability at startup
let localAvailable = false;
(async () => {
    log('INFO', 'Preparing and checking for large model blobs (auto-split if needed)');
    try {
        await prepareModelChunks();
    } catch (e) { log('WARN', 'prepareModelChunks error:', e && e.message ? e.message : e); }

    log('INFO', 'Checking Local GGUF availability...');
    try {
        localAvailable = await localRunner.init();
        if (localAvailable) {
            log('INFO', 'Local GGUF initialized successfully');
        } else {
            log('WARN', 'Local GGUF not available - model may not be found');
        }
    } catch (e) {
        log('ERROR', 'Local GGUF initialization failed:', e.message);
    }
})();

// Simple user database (in-memory for demo)
log('INFO', 'Setting up user database...');
const users = {
    'admin': {
        password: 'LuckAI',
        id: 'user-001'
    }
};
log('INFO', 'Users loaded. Count: 1');

/* ============================================
   AUTHENTICATION MIDDLEWARE
   ============================================ */

log('INFO', 'Setting up authentication middleware...');

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = (authHeader.split(' ')[1] || '').trim();
    const xGuest = req.headers['x-guest'] === 'true';
    const bodyGuest = req.body && req.body.guest === true;

    // If token is missing but client signaled guest or the endpoint is safe, treat as guest
    if (!token) {
        if (xGuest || bodyGuest || req.path === '/api/local/status' || req.path === '/api/chat') {
            log('INFO', `Guest request to ${req.path} from: ${req.ip}`);
            req.user = null;
            return next();
        }
        log('WARN', `Request without token to ${req.path} from: ${req.ip}`);
        return res.status(401).json({ message: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            log('WARN', `Invalid token to ${req.path} from: ${req.ip}`);
            return res.status(403).json({ message: 'Invalid token' });
        }
        log('INFO', 'User authenticated:', user.username);
        req.user = user;
        next();
    });
};

/* ============================================
   API ENDPOINTS
   ============================================ */

log('INFO', 'Registering API endpoints...');

/**
 * Login endpoint
 */
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    log('INFO', 'Login attempt:', username);

    if (!username || !password) {
        log('WARN', 'Login attempt with missing credentials from:', req.ip);
        return res.status(400).json({ message: 'Username and password required' });
    }

    const user = users[username];
    if (!user || user.password !== password) {
        log('WARN', 'Login failed - invalid credentials for:', username);
        return res.status(401).json({ message: 'Invalid credentials' });
    }

    log('INFO', 'Login successful:', username);

    const token = jwt.sign(
        { username, userId: user.id },
        JWT_SECRET,
        { expiresIn: '24h' }
    );

    res.json({
        token,
        user: { username, id: user.id },
        message: 'Login successful'
    });
});

/**
 * Main chat endpoint
 */
// Allow guest access: if no Authorization header, skip authentication and treat as guest
app.post('/api/chat', (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = (authHeader.split(' ')[1] || '').trim();
    const xGuest = req.headers['x-guest'] === 'true';
    const bodyGuest = req.body && req.body.guest === true;

    log('INFO', `/api/chat request: authHeaderPresent=${!!authHeader}, tokenPresent=${!!token}, xGuest=${xGuest}, bodyGuest=${bodyGuest}`);

    // Treat as guest when Authorization header is absent/empty or guest flags are present
    if (!authHeader || authHeader.trim() === '' || !token || xGuest || bodyGuest) {
        req.user = null;
        return chatHandler(req, res);
    }

    // Otherwise validate token
    authenticateToken(req, res, function() {
        return chatHandler(req, res);
    });
});

// The actual chat handler logic
async function chatHandler(req, res) {
    const startTime = Date.now();
    const chatId = Math.random().toString(36).substring(7);
    const username = req.user?.username || 'guest';
    log('INFO', `[Chat ${chatId}] Request from ${username}`);
    try {
        const { message, useWebSearch = true, conversationHistory = [], temperature, maxTokens } = req.body;
        log('INFO', `[Chat ${chatId}] Message length: ${message?.length || 0} chars`);
        if (!message || typeof message !== 'string') {
            log('WARN', `[Chat ${chatId}] Invalid message format`);
            return res.status(400).json({ message: 'Invalid message' });
        }
        if (message.length > 5000) {
            log('WARN', `[Chat ${chatId}] Message too long: ${message.length} chars`);
            return res.status(400).json({ message: 'Message too long (max 5000 characters)' });
        }

        let webContext = null;
        let sources = [];
        let usedWeb = false;
        let searchError = null;
        let searchProvider = null;
        // Determine if web search is needed. Accepts boolean or mode strings: 'always'|'never'|'auto'
        let needsWebSearch = false;
        if (typeof useWebSearch === 'string') {
            const mode = useWebSearch.toLowerCase();
            if (mode === 'always') {
                needsWebSearch = true;
            } else if (mode === 'never') {
                needsWebSearch = false;
            } else {
                // fallback to auto
                needsWebSearch = shouldUseWebSearch(message);
            }
        } else {
            needsWebSearch = useWebSearch && shouldUseWebSearch(message);
        }

        if (needsWebSearch) {
            log('INFO', `[Chat ${chatId}] Web search triggered`);
            const searchResults = await searchClient.search(message);
            if (searchResults) {
                webContext = searchResults.summary;
                sources = searchResults.results.map(r => {
                    let host = '';
                    try { host = (new URL(r.url)).hostname.replace(/^www\./, ''); } catch (e) { host = r.url || ''; }
                    return {
                        title: r.title,
                        url: r.url,
                        snippet: r.description || r.snippet || '',
                        host
                    };
                });
                usedWeb = true;
                searchProvider = searchResults.provider || null;
                log('INFO', `[Chat ${chatId}] Web search completed via ${searchProvider || 'unknown'}. Sources: ${sources.length}`);
            } else {
                log('WARN', `[Chat ${chatId}] Web search failed or returned no results`);
                searchError = 'Web search failed. Please try again later.';
            }
        }

        // Save old runner settings and apply per-request generation settings if provided
        const oldTemperature = localRunner.temperature;
        const oldMaxTokens = localRunner.maxTokens;
        let changedSettings = false;
        if (typeof temperature === 'number' && !Number.isNaN(temperature)) {
            log('INFO', `[Chat ${chatId}] Setting temperature: ${temperature}`);
            try { localRunner.temperature = temperature; changedSettings = true; } catch {}
        }
        if (typeof maxTokens === 'number' && !Number.isNaN(maxTokens)) {
            log('INFO', `[Chat ${chatId}] Setting maxTokens: ${maxTokens}`);
            try { localRunner.maxTokens = maxTokens; changedSettings = true; } catch {}
        }

        try {
            if (!localAvailable) {
                log('WARN', `[Chat ${chatId}] Local engine not available, attempting reinit...`);
                try {
                    localAvailable = await localRunner.init();
                } catch (error) {
                    log('ERROR', `[Chat ${chatId}] Reinitialization failed:`, error.message);
                }
            }

            if (!localAvailable) {
                log('ERROR', `[Chat ${chatId}] Local model unavailable`);
                return res.status(503).json({
                    message: 'Local model unavailable. Place a GGUF model in ./.ollama or ./.ollama/blobs, or set LUCKAI_GGUF_PATH.',
                    usedWeb,
                    sources
                });
            }

            log('INFO', `[Chat ${chatId}] Processing with Local GGUF...`);
            let modelResponse;

            try {
                // Trim conversation history to last N entries to reduce token usage and speed up responses
                const trimmedHistory = (conversationHistory || []).slice(-6);

                // Decide whether to operate in two-phase mode (fast short answer + background full answer)
                const twoPhase = req.body.fast !== false; // default to true for faster perceived latency

                // Query timing for logging
                let queryTime = 0;

                if (twoPhase) {
                    // Phase 1: quick concise response (short max tokens)
                    const shortMax = Math.min(96, localRunner.maxTokens || 96);
                    const shortTemp = Math.min(0.55, localRunner.temperature || 0.55);

                    const shortStart = Date.now();
                    const shortResult = await localRunner.processQuery(message, trimmedHistory, webContext, { maxTokens: shortMax, temperature: shortTemp, short: true });
                    queryTime = Date.now() - shortStart;

                    // If the short response looks incomplete, ask a short continuation synchronously (one attempt)
                    function isProbablyIncomplete(s) {
                        if (!s) return true;
                        const t = String(s).trim();
                        if (t.length < 30) return true; // too short
                        if (/[\.\!\?]$/.test(t)) return false; // ends with full stop
                        if (/\b(and|or|but|if|for|while|because|so|thus|also)\s*$/i.test(t)) return true;
                        if (/\.{3}$/.test(t)) return true;
                        if (/[`*_~]$/.test(t)) return true; // trailing markup
                        if (/```$/.test(t)) return true;
                        return false;
                    }

                    if (isProbablyIncomplete(shortResult.response)) {
                        try {
                            const continuationHistory = trimmedHistory.concat({ role: 'assistant', content: shortResult.response });
                            const cont = await localRunner.processQuery('Continue the previous answer briefly to finish the last sentence without repeating what you already said.', continuationHistory, webContext, { maxTokens: 128, temperature: Math.min(0.7, localRunner.temperature || 0.7) });
                            if (cont && cont.response && cont.response.trim()) {
                                shortResult.response = (shortResult.response + ' ' + cont.response).trim();
                            }
                        } catch (e) {
                            // ignore continuation failure (non-fatal)
                            console.warn('[Chat] Short continuation failed:', e.message);
                        }
                    }

                    // Immediately return short response and kick off background full generation
                    const fullId = Math.random().toString(36).substring(2, 12);
                    fullResponses.set(fullId, { ready: false, answer: null, startedAt: Date.now() });

                    (async () => {
                        try {
                            const fullMax = Math.max(1024, Number(localRunner.maxTokens || 1024));
                            const fullTemp = Math.min(0.9, localRunner.temperature || 0.9);
                            const fullResult = await localRunner.processQuery(message, trimmedHistory, webContext, { maxTokens: fullMax, temperature: fullTemp });
                            // Sanitize the full result to strip redirect/uddg lines before storing
                            let fullText = String(fullResult.response || '');
                            const fullLines = fullText.split(/\r?\n/).filter(Boolean);
                            let sanitizedFull = fullLines.filter(l => {
                                const t = String(l || '').trim();
                                if (!t) return false;
                                if (/duckduckgo\.com\/l\//i.test(t)) return false;
                                if (/\buddg=/i.test(t)) return false;
                                if (/^https?:\/\//i.test(t) || /^\/\//.test(t)) return false;
                                if (/(%3A|%2F|%3D|%26|%3F)/i.test(t) && t.length > 24) return false;
                                if (/[\/%=\?&]/.test(t) && t.length > 40) return false;
                                return true;
                            }).join('\n').trim();

                            // If sanitization removed everything, build a permissive fallback to preserve content
                            if (!sanitizedFull && fullText && fullText.trim()) {
                                try {
                                    let fallback = String(fullText || '');
                                    // strip common redirect fragments
                                    fallback = fallback.replace(/https?:\/\/duckduckgo\.com\/l\/[A-Za-z0-9_\-]+/ig, '');
                                    fallback = fallback.replace(/uddg=[A-Za-z0-9%_\-]+/ig, '');
                                    // replace long encoded runs with a short marker
                                    fallback = fallback.replace(/(%3A|%2F|%3D|%26|%3F)[A-Za-z0-9%]{10,}/ig, ' [link]');
                                    // keep first several non-empty lines
                                    fallback = fallback.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 30).join('\n');
                                    if (fallback.length > 8000) fallback = fallback.slice(0, 8000) + '...';
                                    sanitizedFull = fallback.trim();
                                    log('WARN', `[Chat ${chatId}] Full response sanitization removed content; storing permissive fallback (${sanitizedFull.length} chars)`);
                                } catch (e) {
                                    // leave sanitizedFull empty if fallback generation failed
                                }
                            }

                            fullResponses.set(fullId, { ready: true, answer: sanitizedFull, startedAt: Date.now(), finishedAt: Date.now() });
                        } catch (err) {
                            // Sanitize short result before storing as full fallback
                            let sr = String(shortResult.response || '');
                            const srLines = sr.split(/\r?\n/).filter(Boolean);
                            const sanitizedShort = srLines.filter(l => {
                                const t = String(l || '').trim();
                                if (!t) return false;
                                if (/duckduckgo\.com\/l\//i.test(t)) return false;
                                if (/\buddg=/i.test(t)) return false;
                                if (/^https?:\/\//i.test(t) || /^\/\//.test(t)) return false;
                                if (/(%3A|%2F|%3D|%26|%3F)/i.test(t) && t.length > 24) return false;
                                if (/[\/%=\?&]/.test(t) && t.length > 40) return false;
                                return true;
                            }).join('\n').trim();
                            fullResponses.set(fullId, { ready: true, answer: sanitizedShort || shortResult.response, error: err.message });
                        }
                    })();

                    modelResponse = {
                        answer: shortResult.response,
                        pendingFull: true,
                        fullId,
                        language: shortResult.language,
                        model: shortResult.model,
                        stats: Object.assign(shortResult.stats || {}, { phase: 'short' })
                    };

                } else {
                    // Single-phase: full generation
                    const queryStartTime = Date.now();
                    const localResult = await localRunner.processQuery(
                        message,
                        trimmedHistory,
                        webContext
                    );
                    queryTime = Date.now() - queryStartTime;

                    modelResponse = {
                        answer: localResult.response,
                        language: localResult.language,
                        model: localResult.model,
                        stats: localResult.stats
                    };
                }
                
                log('INFO', `[Chat ${chatId}] Query processed in ${queryTime}ms`);
            } catch (error) {
                log('ERROR', `[Chat ${chatId}] Generation error:`, error.message);
                return res.status(500).json({ message: 'Local model error', usedWeb, sources });
            }

            const totalTime = Date.now() - startTime;
            log('INFO', `[Chat ${chatId}] Response complete in ${totalTime}ms`);

            // Sanitize answer: remove raw source URL lines or duckduckgo redirect lines so UI shows only the pill/panel
                        const rawAnswer = String(modelResponse.answer || '');
                        let safeAnswer = rawAnswer;

                        const lines = rawAnswer.split(/\r?\n/);
                        const filtered = lines.filter(line => {
                            const t = String(line || '').trim();
                            if (!t) return true;
                            // Remove if contains exact source URL
                            if (sources && sources.length && sources.some(s => s.url && t.includes(s.url))) return false;
                            // Remove duckduckgo redirect fragments and uddg params
                            if (/duckduckgo\.com\/l\//i.test(t)) return false;
                            if (/\buddg=/i.test(t)) return false;
                            // Remove lines that look like raw URLs
                            if (/^https?:\/\//i.test(t) || /^\/\//.test(t)) return false;
                            // Remove encoded URL-like lines (many percent-encoded sequences or long query strings)
                            if (/(%3A|%2F|%3D|%26|%3F)/i.test(t) && t.length > 24) return false;
                            if (/[\/%=\?&]/.test(t) && t.length > 40) return false;
                            return true;
                        });
                        safeAnswer = filtered.join('\n').trim();

                        // If sanitization removed everything, fall back to a permissive cleaned version instead of returning an empty message
                        if (!safeAnswer && rawAnswer && rawAnswer.trim()) {
                            try {
                                let fallback = String(rawAnswer || '');
                                // Remove explicit redirect fragments
                                fallback = fallback.replace(/https?:\/\/duckduckgo\.com\/l\/[A-Za-z0-9_\-]+/ig, '');
                                fallback = fallback.replace(/uddg=[A-Za-z0-9%_\-]+/ig, '');
                                // Replace long percent-encoded chunks with a short token
                                fallback = fallback.replace(/(%3A|%2F|%3D|%26|%3F)[A-Za-z0-9%]{10,}/ig, ' [link]');
                                // Trim very long lines but keep text
                                fallback = fallback.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 10).join('\n');
                                if (fallback.length > 2000) fallback = fallback.slice(0, 2000) + '...';
                                safeAnswer = fallback.trim();
                                log('WARN', `[Chat ${chatId}] Sanitization removed original content; serving permissive fallback (${safeAnswer.length} chars)`);
                            } catch (e) {
                                safeAnswer = '';
                            }
                        }
            
                        res.json({
                            answer: safeAnswer,
                            pendingFull: modelResponse.pendingFull || false,
                            fullId: modelResponse.fullId || null,
                            language: modelResponse.language,
                            usedWeb: usedWeb,
                            sources: sources,
                            model: modelResponse.model,
                            searchError: searchError, // present when web search failed
                            searchProvider: searchProvider || null
                        });
        } finally {
            // Restore transient settings if we changed them
            if (changedSettings) {
                try { localRunner.temperature = oldTemperature; } catch {}
                try { localRunner.maxTokens = oldMaxTokens; } catch {}
            }
        }
    } catch (error) {
        log('ERROR', 'Chat endpoint error:', error.message);
        res.status(500).json({ message: 'Error processing request' });
    }
}

/**
 * Verify token endpoint
 */
app.get('/api/verify', authenticateToken, (req, res) => {
    log('INFO', `Token verified for user: ${req.user?.username || 'guest'}`);
    res.json({ valid: true, user: req.user });
});

/**
 * Record user feedback for a specific assistant message
 */
app.post('/api/feedback', (req, res) => {
    const username = req.user?.username || 'guest';
    const { messageId, feedback, content, prompt } = req.body || {};
    if (!messageId || !feedback) {
        return res.status(400).json({ ok: false, message: 'messageId and feedback are required' });
    }
    if (!['up', 'down'].includes(feedback)) {
        return res.status(400).json({ ok: false, message: 'feedback must be "up" or "down"' });
    }

    // Ensure data dir exists
    try { if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data')); } catch (e) {}

    const entry = {
        timestamp: new Date().toISOString(),
        username,
        messageId,
        feedback,
        content: content || '',
        prompt: prompt || '',
        userAgent: req.headers['user-agent'] || '',
        ip: req.ip || ''
    };

    const file = path.join(__dirname, 'data', 'feedback.jsonl');
    try {
        fs.appendFileSync(file, JSON.stringify(entry) + os.EOL);
        log('INFO', 'Feedback recorded:', JSON.stringify({ messageId, feedback }));
    } catch (e) {
        log('ERROR', 'Failed to write feedback:', e && e.message ? e.message : e);
    }

    res.json({ ok: true });
});

/**
 * Local GGUF status endpoint
 */
app.get('/api/local/status', authenticateToken, async (req, res) => {
    const username = req.user?.username || 'guest';
    log('INFO', 'Status check from:', username);
    try {
        res.json({
            status: localAvailable ? 'available' : 'unavailable',
            modelPath: process.env.LUCKAI_GGUF_PATH || null,
            provider: 'local-gguf'
        });
    } catch (error) {
        log('ERROR', 'Status check error:', error.message);
        res.status(500).json({ message: error.message });
    }
});

/**
 * Determine if web search should be used
 */
function shouldUseWebSearch(message) {
    const lowerMsg = message.toLowerCase();
    
    // Keywords that indicate need for web search
    const webSearchKeywords = [
        'recent', 'today', 'yesterday', 'tomorrow', 'news', 'current',
        'latest', 'when', 'where', 'what is', 'tell me about', 'how to',
        '2024', '2025', 'this week', 'this month', 'trending', 'new',
        'actualité', 'nouvelle', 'récent', 'aujourd', 'comment faire', 'quand'
    ];

    // Only trigger web search for sufficiently long queries (avoid slow searches for short Qs)
    if ((message || '').length < 30) return false;
    return webSearchKeywords.some(keyword => lowerMsg.includes(keyword));
}

/**
 * Root endpoints with language support
 */
log('INFO', 'Registering route handlers...');

// Endpoint to fetch full generated answer when background generation completes
app.get('/api/chat/full/:id', (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const entry = fullResponses.get(id);
    if (!entry) return res.status(404).json({ ready: false });
    res.json({ ready: !!entry.ready, answer: entry.answer, error: entry.error || null });
});

// English (default)
app.get('/', (req, res) => {
    log('INFO', 'Serving index page (English)');
    res.sendFile(path.join(__dirname, 'html', 'index.html'));
});

// Login page (English)
app.get('/login', (req, res) => {
    log('INFO', 'Serving login page (English)');
    res.sendFile(path.join(__dirname, 'html', 'login.html'));
});

// French
app.get('/fr', (req, res) => {
    log('INFO', 'Serving index page (French)');
    res.sendFile(path.join(__dirname, 'html', 'index-fr.html'));
});

// Login page (French)
app.get('/fr/login', (req, res) => {
    log('INFO', 'Serving login page (French)');
    res.sendFile(path.join(__dirname, 'html', 'login-fr.html'));
});

// Chat (English)
app.get('/chat', (req, res) => {
    log('INFO', 'Serving chat page (English)');
    res.sendFile(path.join(__dirname, 'html', 'chat.html'));
});

// Chat (French)
app.get('/fr/chat', (req, res) => {
    log('INFO', 'Serving chat page (French)');
    res.sendFile(path.join(__dirname, 'html', 'chat-fr.html'));
});

// Index page (English)
app.get('/index.html', (req, res) => {
    log('INFO', 'Serving index page (English)');
    res.sendFile(path.join(__dirname, 'html', 'index.html'));
});

// Index page (French)
app.get('/fr/index.html', (req, res) => {
    log('INFO', 'Serving index page (French)');
    res.sendFile(path.join(__dirname, 'html', 'index.html'));
});

/* ============================================
   ERROR HANDLING & SERVER START
   ============================================ */

log('INFO', 'Setting up error handler...');

app.use((err, req, res, next) => {
    log('ERROR', 'Server error:', err.message);
    res.status(500).json({ message: 'Internal server error' });
});

log('INFO', 'Starting server...');

app.listen(PORT, () => {
    const startTime = new Date().toLocaleString();
    log('INFO', '========== LuckAI Server Started ==========');
    log('INFO', `Port: ${PORT}`);
    log('INFO', `URL: http://localhost:${PORT}/`);
    log('INFO', `Time: ${startTime}`);
    log('INFO', `Local GGUF: ${localAvailable ? 'Ready' : 'Not available'}`);
    log('INFO', '==========================================');
});

module.exports = app
