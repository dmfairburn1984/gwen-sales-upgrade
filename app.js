// ============================================
// MINT OUTDOOR AI SYSTEM v12.0 - GWEN SALES AGENT
// Complete rebuild with integrated KPI analytics
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

// ============================================
// SECTION 1: INITIALIZATION & CONFIGURATION
// ============================================

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Email configuration
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Database setup
const pool = process.env.DATABASE_URL ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
}) : null;

// Core settings
const ENABLE_SALES_MODE = process.env.ENABLE_SALES_MODE === 'true';
const sessions = new Map();
const SHOPIFY_DOMAIN = 'bb69ce-b5.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const ESCALATION_EMAILS = ['rachel@mint-outdoor.com', 'marketing@mint-outdoor.com'];

// ============================================
// SECTION 2: ANALYTICS & LOGGING SYSTEM
// ============================================

// Initialize analytics tables on startup
async function initializeAnalyticsTables() {
    if (!pool) {
        console.log('⚠️ No database connection - analytics will be limited');
        return;
    }
    
    try {
        // Chat logs table (existing)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_logs (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                role VARCHAR(20),
                message TEXT
            )
        `);
        
        // Chat events table (NEW - for KPI tracking)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_events (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) NOT NULL,
                event_type VARCHAR(50) NOT NULL,
                event_data JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Session summary table (NEW - for conversion tracking)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS session_summary (
                session_id VARCHAR(255) PRIMARY KEY,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ended_at TIMESTAMP,
                message_count INTEGER DEFAULT 0,
                products_viewed INTEGER DEFAULT 0,
                bundle_offered BOOLEAN DEFAULT FALSE,
                bundle_accepted BOOLEAN DEFAULT FALSE,
                email_captured BOOLEAN DEFAULT FALSE,
                email_address VARCHAR(255),
                handoff_triggered BOOLEAN DEFAULT FALSE,
                persona_detected VARCHAR(50),
                final_interest_score INTEGER DEFAULT 0
            )
        `);
        
        // Product interactions table (NEW - for product performance)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS product_interactions (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) NOT NULL,
                sku VARCHAR(100) NOT NULL,
                product_name VARCHAR(255),
                price DECIMAL(10,2),
                interaction_type VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create indexes for performance
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_events_session ON chat_events(session_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_events_type ON chat_events(event_type)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_events_created ON chat_events(created_at)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_interactions_sku ON product_interactions(sku)`);
        
        console.log('✅ Analytics tables initialized');
    } catch (error) {
        console.error('❌ Failed to initialize analytics tables:', error.message);
    }
}

// Basic chat logging (existing functionality)
async function logChat(sessionId, role, message) {
    if (!pool) {
        console.log(`Chat Log: ${sessionId} - ${role}: ${message.substring(0, 50)}...`);
        return;
    }
    try {
        await pool.query(
            'INSERT INTO chat_logs (session_id, role, message) VALUES ($1, $2, $3)',
            [sessionId, role, message]
        );
    } catch (error) {
        console.log('Database logging skipped:', error.message);
    }
}

// NEW: Log analytics events
async function logEvent(sessionId, eventType, eventData = {}) {
    if (!pool) {
        console.log(`📊 Event: ${sessionId} - ${eventType}`, eventData);
        return;
    }
    try {
        await pool.query(
            'INSERT INTO chat_events (session_id, event_type, event_data) VALUES ($1, $2, $3)',
            [sessionId, eventType, JSON.stringify(eventData)]
        );
        console.log(`📊 Logged event: ${eventType} for session ${sessionId.substring(0,8)}...`);
    } catch (error) {
        console.error('Event logging failed:', error.message);
    }
}

// NEW: Update session summary
async function updateSessionSummary(sessionId, updates) {
    if (!pool) return;
    
    try {
        // Check if session exists
        const existing = await pool.query(
            'SELECT session_id FROM session_summary WHERE session_id = $1',
            [sessionId]
        );
        
        if (existing.rows.length === 0) {
            // Create new session
            await pool.query(
                'INSERT INTO session_summary (session_id) VALUES ($1)',
                [sessionId]
            );
        }
        
        // Build dynamic update query
        const setClauses = [];
        const values = [];
        let paramIndex = 1;
        
        for (const [key, value] of Object.entries(updates)) {
            setClauses.push(`${key} = $${paramIndex}`);
            values.push(value);
            paramIndex++;
        }
        
        if (setClauses.length > 0) {
            values.push(sessionId);
            await pool.query(
                `UPDATE session_summary SET ${setClauses.join(', ')} WHERE session_id = $${paramIndex}`,
                values
            );
        }
    } catch (error) {
        console.error('Session summary update failed:', error.message);
    }
}

// NEW: Log product interaction
async function logProductInteraction(sessionId, sku, productName, price, interactionType) {
    if (!pool) return;
    
    try {
        const numericPrice = typeof price === 'string' ? 
            parseFloat(price.replace(/[£$,]/g, '')) : price;
        
        await pool.query(
            `INSERT INTO product_interactions (session_id, sku, product_name, price, interaction_type) 
             VALUES ($1, $2, $3, $4, $5)`,
            [sessionId, sku, productName, numericPrice || null, interactionType]
        );
    } catch (error) {
        console.error('Product interaction logging failed:', error.message);
    }
}

// NEW: Increment message count
async function incrementMessageCount(sessionId) {
    if (!pool) return;
    
    try {
        await pool.query(
            `UPDATE session_summary SET message_count = message_count + 1 WHERE session_id = $1`,
            [sessionId]
        );
    } catch (error) {
        console.error('Message count increment failed:', error.message);
    }
}

// ============================================
// SECTION 3: DATA LOADING & INDEXING
// ============================================

function loadDataFile(filename, defaultValue = []) {
    const dataPath = path.join(__dirname, 'data', filename);
    try {
        const rawData = fs.readFileSync(dataPath, 'utf8');
        const parsedData = JSON.parse(rawData);
        console.log(`✅ Loaded ${filename} (${Array.isArray(parsedData) ? parsedData.length + ' items' : 'object'})`);
        return parsedData;
    } catch (error) {
        console.error(`❌ Failed to load ${filename}: ${error.message}`);
        return defaultValue;
    }
}

// Load unified product knowledge center
const productKnowledgeCenter = loadDataFile('product_knowledge_center.json', []);

// Load operational files
const orderData = loadDataFile('Gwen_PO_Order_Report.json', []);
const bundleSuggestions = loadDataFile('bundle_suggestions.json', []);
const bundleItems = loadDataFile('bundle_items.json', []);
const inventoryData = loadDataFile('Inventory_Data.json', []);

// Build performance indexes
const productIndex = {
    bySku: {},
    byCategory: {},
    byMaterial: {},
    bySeats: {},
    byFamily: {},
    byTaxonomy: {}
};

console.log('🔨 Building product indexes...');
productKnowledgeCenter.forEach(product => {
    const sku = product.product_identity?.sku;
    if (!sku) return;
    
    productIndex.bySku[sku] = product;
    
    const category = product.description_and_category?.primary_category;
    if (category) {
        if (!productIndex.byCategory[category]) productIndex.byCategory[category] = [];
        productIndex.byCategory[category].push(product);
    }
    
    const material = product.description_and_category?.material_type;
    if (material) {
        if (!productIndex.byMaterial[material]) productIndex.byMaterial[material] = [];
        productIndex.byMaterial[material].push(product);
    }
    
    const seats = product.specifications?.seats;
    if (seats && !isNaN(parseInt(seats))) {
        const seatCount = parseInt(seats);
        if (!productIndex.bySeats[seatCount]) productIndex.bySeats[seatCount] = [];
        productIndex.bySeats[seatCount].push(product);
    }
    
    const taxonomyType = product.description_and_category?.taxonomy_type;
    if (taxonomyType) {
        if (!productIndex.byTaxonomy[taxonomyType]) productIndex.byTaxonomy[taxonomyType] = [];
        productIndex.byTaxonomy[taxonomyType].push(product);
    }
});

// Build material maintenance maps
const materialMaintenanceMap = {};
productKnowledgeCenter.forEach(product => {
    if (product.materials_and_care) {
        product.materials_and_care.forEach(material => {
            if (!materialMaintenanceMap[material.name]) {
                materialMaintenanceMap[material.name] = {
                    maintenance: material.maintenance,
                    durability: material.durability_rating,
                    weather_resistance: material.weather_resistance,
                    warranty: material.warranty,
                    pros: material.pros,
                    cons: material.cons
                };
            }
        });
    }
});

// Backwards compatibility objects
const productData = productKnowledgeCenter.map(p => ({
    sku: p.product_identity?.sku,
    product_title: p.product_identity?.product_name,
    price: 'Check Shopify',
    category: p.description_and_category?.primary_category,
    material: p.description_and_category?.material_type,
    seats: p.specifications?.seats
})).filter(p => p.sku);

console.log('📊 DATA LOADING COMPLETE:');
console.log(`   📦 Products indexed: ${Object.keys(productIndex.bySku).length}`);
console.log(`   📂 Categories: ${Object.keys(productIndex.byCategory).length}`);
console.log(`   🎨 Materials: ${Object.keys(productIndex.byMaterial).length}`);
console.log(`   🪑 Seat configurations: ${Object.keys(productIndex.bySeats).length}`);
console.log(`   🎁 Bundle suggestions: ${bundleSuggestions.length}`);
console.log(`   📋 Orders loaded: ${orderData.length}`);

// ============================================
// SECTION 4: DETECTION FUNCTIONS
// ============================================

function detectCustomerInterest(message, session) {
    const strongBuyingSignals = [
        'love this', 'love it', 'perfect', 'exactly what', 'looks great',
        'beautiful', 'gorgeous', 'stunning', 'ideal', 'this would work',
        'i need this', 'we need this', 'i want this', 'i want that',
        'how much', 'price', 'cost', 'delivery', 'assembly', 'available',
        'in stock', 'when can', 'how long', 'i like', 'like this',
        'like that', 'like the', 'interested', 'this one', 'that one',
        'want to buy', 'want to order', 'ready to buy', 'ready to order',
        "i'll take", "let's do it", 'sounds good', 'looks good'
    ];
    
    const lowerMessage = message.toLowerCase();
    if (message.length < 4) return false;
    
    const browsingPhrases = ['what about', 'do you have', 'show me', 'tell me about'];
    if (browsingPhrases.some(phrase => lowerMessage.startsWith(phrase))) return false;
    
    const hasInterest = strongBuyingSignals.some(signal => lowerMessage.includes(signal));
    const hasSeenProducts = session.conversationHistory.some(msg =>
        msg.role === 'assistant' && msg.content.includes('Price: £')
    );
    
    return hasInterest && hasSeenProducts;
}

function calculateCustomerInterestScore(session) {
    let score = 0;
    const recentMessages = session.conversationHistory.slice(-6);
    const buyingSignals = [
        'love', 'perfect', 'like', 'nice', 'beautiful',
        'ideal', 'exactly', 'great', 'amazing', 'interested'
    ];
    
    recentMessages.forEach(msg => {
        if (msg.role === 'user') {
            const msgLower = msg.content.toLowerCase();
            
            if (msgLower.includes('love this') ||
                msgLower.includes('perfect') ||
                msgLower.includes('exactly what')) {
                score += 3;
            }
            
            buyingSignals.forEach(signal => {
                if (msgLower.includes(signal)) score += 1;
            });
            
            if (msgLower.includes('malai') ||
                msgLower.includes('marbella') ||
                msgLower.includes('lima') ||
                msgLower.includes('palma')) {
                score += 2;
            }
        }
    });
    
    const productsSeen = session.conversationHistory.filter(msg =>
        msg.role === 'assistant' &&
        msg.content.includes('£') &&
        (msg.content.includes('Price:') || msg.content.includes('at just £'))
    ).length;
    
    score += Math.min(productsSeen * 2, 6);
    
    if (session.conversationHistory.length >= 8) score += 2;
    if (session.conversationHistory.length >= 12) score += 2;
    
    if (session.context.startTime) {
        const minutesEngaged = (Date.now() - session.context.startTime) / 60000;
        if (minutesEngaged > 3) score += 2;
    }
    
    return score;
}

function hasShownProductInterest(session) {
    const recentMessages = session.conversationHistory.slice(-3);
    const interestPhrases = [
        'i prefer', 'i like', 'perfect', 'love it', 'looks good',
        'tell me more', 'interested', 'this one', 'the palma',
        'the lima', 'the marbella', 'beautiful', 'nice'
    ];
    
    return recentMessages.some(msg =>
        msg.role === 'user' &&
        interestPhrases.some(phrase =>
            msg.content.toLowerCase().includes(phrase)
        )
    );
}

function shouldOfferBundleNaturally(session) {
    const interestScore = calculateCustomerInterestScore(session);
    
    if (session.context.offeredBundle || session.context.waitingForPackageResponse) {
        return false;
    }
    
    console.log(`💰 Bundle Decision - Interest Score: ${interestScore}/15`);
    
    if (interestScore >= 8) {
        session.context.bundleReady = true;
        return true;
    }
    
    return false;
}

function extractCustomerDetails(message) {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const emailMatch = message.match(emailRegex);
    
    const postcodeRegex = /\b[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}\b/i;
    const postcodeMatch = message.match(postcodeRegex);
    
    return {
        email: emailMatch ? emailMatch[0] : null,
        postcode: postcodeMatch ? postcodeMatch[0].toUpperCase() : null,
        hasRequiredInfo: !!(emailMatch && postcodeMatch)
    };
}

function detectCustomerPersona(conversationHistory) {
    const fullConversation = conversationHistory
        .map(msg => msg.content)
        .join(' ')
        .toLowerCase();
    
    const personaSignals = {
        entertainer: ['hosting', 'guests', 'entertaining', 'dinner parties', 'gatherings', 'impress', 'elegant', 'sophisticated'],
        family: ['family', 'kids', 'children', 'practical', 'durable', 'easy to clean', 'safe', 'everyday use'],
        style_conscious: ['design', 'aesthetic', 'modern', 'contemporary', 'style', 'look', 'appearance', 'beautiful'],
        budget_conscious: ['budget', 'price', 'cost', 'affordable', 'value', 'deal', 'cheap', 'expensive']
    };
    
    let scores = {};
    for (const [persona, signals] of Object.entries(personaSignals)) {
        scores[persona] = signals.filter(signal => fullConversation.includes(signal)).length;
    }
    
    const topPersona = Object.entries(scores).reduce((a, b) => scores[a[0]] > scores[b[0]] ? a : b);
    return topPersona[1] > 0 ? topPersona[0] : 'default';
}

function detectPurpose(conversationHistory, currentMessage = '') {
    const fullContext = conversationHistory
        .map(msg => typeof msg === 'string' ? msg : msg.content || '')
        .concat(currentMessage)
        .join(' ')
        .toLowerCase();
    
    const patterns = {
        'dining': ['dining', 'table', 'eat', 'meal', 'dinner', 'lunch', 'breakfast', 'chairs and table', 'dining set', 'dining table', 'outdoor dining'],
        'lounge': ['lounge', 'relax', 'sofa', 'couch', 'seating area', 'comfortable', 'chill', 'relaxation', 'lounge set', 'outdoor sofa'],
        'corner': ['corner', 'L-shape', 'sectional', 'modular', 'corner sofa', 'corner set'],
        'lounger': ['lounger', 'sunbed', 'tanning', 'lie down', 'pool', 'sunbathing', 'daybed', 'sun lounger'],
        'hybrid': ['both', 'dining and lounge', 'everything', 'complete', 'all']
    };
    
    for (const [purpose, keywords] of Object.entries(patterns)) {
        if (keywords.some(keyword => fullContext.includes(keyword))) {
            return purpose;
        }
    }
    return null;
}

function detectCapacity(conversationHistory, currentMessage = '') {
    const fullContext = conversationHistory
        .map(msg => typeof msg === 'string' ? msg : msg.content || '')
        .concat(currentMessage)
        .join(' ');
    
    const numbers = fullContext.match(/\b(\d+)\s*(people|person|seater|seats|guests|seat)\b/gi);
    if (numbers && numbers.length > 0) {
        const lastMatch = numbers[numbers.length - 1];
        const num = parseInt(lastMatch.match(/\d+/)[0]);
        return num;
    }
    
    const sizeWords = {
        'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
    };
    
    for (const [word, num] of Object.entries(sizeWords)) {
        const pattern = new RegExp(`\\b${word}\\s*(people|person|seater|seats|guests)\\b`, 'gi');
        if (pattern.test(fullContext)) {
            return num;
        }
    }
    return null;
}

function detectMaterial(conversationHistory, currentMessage = '') {
    const fullContext = conversationHistory
        .map(msg => typeof msg === 'string' ? msg : msg.content || '')
        .concat(currentMessage)
        .join(' ')
        .toLowerCase();
    
    const materials = {
        'teak': ['teak', 'wood', 'wooden', 'hardwood', 'natural wood'],
        'aluminium': ['aluminium', 'aluminum', 'metal', 'steel'],
        'rattan': ['rattan', 'wicker', 'woven', 'synthetic rattan', 'poly rattan'],
        'mixed': ['combination', 'mixed', 'both']
    };
    
    for (const [material, keywords] of Object.entries(materials)) {
        if (keywords.some(keyword => fullContext.includes(keyword))) {
            return material;
        }
    }
    return null;
}

function detectBudget(conversationHistory, currentMessage = '') {
    const fullContext = conversationHistory
        .map(msg => typeof msg === 'string' ? msg : msg.content || '')
        .concat(currentMessage)
        .join(' ');
    
    const priceMatch = fullContext.match(/[£$]\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    if (priceMatch) {
        return parseFloat(priceMatch[1].replace(/,/g, ''));
    }
    
    const budgetMatch = fullContext.match(/(\d+(?:,\d{3})*)\s*(?:pound|dollar|budget|max|maximum)/i);
    if (budgetMatch) {
        return parseFloat(budgetMatch[1].replace(/,/g, ''));
    }
    return null;
}

function detectSpace(conversationHistory, currentMessage = '') {
    const fullContext = conversationHistory
        .map(msg => typeof msg === 'string' ? msg : msg.content || '')
        .concat(currentMessage)
        .join(' ')
        .toLowerCase();
    
    const spacePatterns = {
        'small': ['small', 'compact', 'limited space', 'tight', 'cozy', 'apartment', 'balcony'],
        'medium': ['medium', 'average', 'normal', 'standard'],
        'large': ['large', 'big', 'spacious', 'huge', 'plenty of room', 'extensive']
    };
    
    for (const [size, keywords] of Object.entries(spacePatterns)) {
        if (keywords.some(keyword => fullContext.includes(keyword))) {
            return size;
        }
    }
    return null;
}

function detectColor(conversationHistory, currentMessage = '') {
    const fullContext = conversationHistory
        .map(msg => typeof msg === 'string' ? msg : msg.content || '')
        .concat(currentMessage)
        .join(' ')
        .toLowerCase();
    
    const colors = ['black', 'grey', 'gray', 'brown', 'beige', 'white', 'natural', 'charcoal'];
    
    for (const color of colors) {
        if (fullContext.includes(color)) {
            return color === 'gray' ? 'grey' : color;
        }
    }
    return null;
}

function detectFeatures(conversationHistory, currentMessage = '') {
    const fullContext = conversationHistory
        .map(msg => typeof msg === 'string' ? msg : msg.content || '')
        .concat(currentMessage)
        .join(' ')
        .toLowerCase();
    
    const features = [];
    const featurePatterns = {
        'low_maintenance': ['low maintenance', 'no maintenance', 'easy care', 'maintenance free', 'easy to clean', 'easy to look after'],
        'weather_resistant': ['weatherproof', 'all weather', 'weather resistant', 'waterproof', 'outdoor', 'rain proof'],
        'space_saving': ['compact', 'small space', 'balcony', 'limited space', 'foldable', 'stackable'],
        'modular': ['modular', 'configurable', 'flexible', 'rearrange', 'customizable'],
        'with_storage': ['storage', 'cushion box', 'storage space'],
        'quick_delivery': ['quick delivery', 'fast delivery', 'need soon', 'urgent', 'asap'],
        'assembly_service': ['assembly', 'installation', 'set up for me', 'assembled']
    };
    
    Object.entries(featurePatterns).forEach(([feature, keywords]) => {
        if (keywords.some(keyword => fullContext.includes(keyword))) {
            features.push(feature);
        }
    });
    
    return features.length > 0 ? features : null;
}

function detectOrderInquiry(message) {
    const orderKeywords = [
        'order', 'delivery', 'tracking', 'shipped', 'dispatch', 'courier',
        'when will', 'where is', 'status of', 'delayed', 'late', 'received',
        'order number', 'tracking number', 'delivered', 'refund', 'return',
        'cancel', 'change order', 'modify order', 'update order'
    ];
    
    const hasOrderNumber = /\b\d{6,}\b/.test(message);
    const hasOrderKeywords = orderKeywords.some(keyword =>
        message.toLowerCase().includes(keyword)
    );
    
    return hasOrderNumber || hasOrderKeywords;
}

function detectMarketingHandoff(message, conversationHistory) {
    const marketingTriggers = [
        'want to place an order', 'ready to buy', 'purchase this',
        'call me', 'phone me', 'email me', 'contact me back',
        'speak to someone', 'human', 'real person', 'customer service',
        'complaint', 'manager', 'supervisor', 'not satisfied'
    ];
    
    return marketingTriggers.some(trigger =>
        message.toLowerCase().includes(trigger)
    );
}

// ============================================
// SECTION 4B: SMART QUERY ANALYZER
// ============================================

function analyzeQueryCompleteness(conversationHistory, currentMessage) {
    // Detect what info we already have from the conversation
    const detectedSeats = detectCapacity(conversationHistory, currentMessage);
    const detectedMaterial = detectMaterial(conversationHistory, currentMessage);
    const detectedBudget = detectBudget(conversationHistory, currentMessage);
    const detectedPurpose = detectPurpose(conversationHistory, currentMessage);
    const detectedSpace = detectSpace(conversationHistory, currentMessage);
    const detectedFeatures = detectFeatures(conversationHistory, currentMessage);
    
    // Check for specific product request (e.g., "Barcelona 9 seater", "Palma corner")
    const lowerMessage = currentMessage.toLowerCase();
    const productNames = ['barcelona', 'palma', 'marbella', 'stockholm', 'santorini', 'chesterton', 'kiki', 'faro', 'malaga', 'tenerife', 'lyon', 'cannes'];
    const isSpecificProductRequest = productNames.some(name => lowerMessage.includes(name));
    
    // Count how many key criteria we have
    const infoGathered = {
        seats: detectedSeats,
        material: detectedMaterial,
        budget: detectedBudget,
        purpose: detectedPurpose,
        space: detectedSpace,
        features: detectedFeatures,
        specificProduct: isSpecificProductRequest
    };
    
    const infoCount = [
        detectedSeats !== null,
        detectedMaterial !== null,
        detectedBudget !== null,
        detectedPurpose !== null
    ].filter(Boolean).length;
    
    // Determine what's missing (priority order)
    const missing = [];
    if (detectedSeats === null) missing.push('seats');
    if (detectedMaterial === null) missing.push('material');
    // Budget is lower priority - we can infer from behavior
    
    // Determine readiness to show products
    let readyToShowProducts = false;
    let qualificationNeeded = null;
    
    // READY TO SHOW PRODUCTS IF:
    // 1. Specific product requested by name
    // 2. Have 2+ pieces of info (seats + material, or seats + purpose, etc.)
    // 3. Customer gave seats AND material
    // 4. Second or later message in conversation (they've engaged)
    
    if (isSpecificProductRequest) {
        readyToShowProducts = true;
        qualificationNeeded = null;
    } else if (detectedSeats !== null && detectedMaterial !== null) {
        readyToShowProducts = true;
        qualificationNeeded = null;
    } else if (infoCount >= 2) {
        readyToShowProducts = true;
        qualificationNeeded = null;
    } else if (conversationHistory.length >= 4) {
        // After 2 exchanges, show products anyway with best guess
        readyToShowProducts = true;
        qualificationNeeded = null;
    } else {
        // Need to ask ONE qualifying question
        readyToShowProducts = false;
        
        // Priority: Seats first (easiest), then material
        if (detectedSeats === null && detectedPurpose !== null) {
            qualificationNeeded = 'seats';
        } else if (detectedPurpose === null) {
            qualificationNeeded = 'purpose_with_seats';
        } else if (detectedMaterial === null) {
            qualificationNeeded = 'material';
        } else {
            qualificationNeeded = 'seats';
        }
    }
    
    return {
        gathered: infoGathered,
        infoCount: infoCount,
        missing: missing,
        readyToShowProducts: readyToShowProducts,
        qualificationNeeded: qualificationNeeded,
        isSpecificProduct: isSpecificProductRequest,
        summary: `Seats: ${detectedSeats || 'unknown'}, Material: ${detectedMaterial || 'unknown'}, Purpose: ${detectedPurpose || 'unknown'}, Budget: ${detectedBudget || 'unknown'}`
    };
}

function getSmartQualificationQuestion(qualificationType, detectedPurpose) {
    const questions = {
        'seats': [
            "How many people do you typically need to seat? Are you thinking 4-6 for everyday use, or 8+ for entertaining?",
            "Quick question - how many seats are you looking for?",
            "What size are you thinking - cosy 4-seater or bigger for hosting friends?"
        ],
        'purpose_with_seats': [
            "Are you looking for a dining setup or more of a lounge/relaxation area? And roughly how many people?",
            "What's the main use - dining, lounging, or both? And for how many people typically?"
        ],
        'material': [
            "Do you have a material preference? We have modern aluminium (zero maintenance), natural rattan (classic look), or premium teak (ages beautifully).",
            "Any preference on material - aluminium, rattan, or teak? Each has different maintenance levels.",
            "What's more important - the sleek modern look of aluminium, the warmth of natural rattan, or the premium feel of solid teak?"
        ],
        'material_with_maintenance': [
            "How much maintenance are you up for? Aluminium is zero effort, rattan needs occasional cleaning, teak can be left natural or oiled.",
            "Do you want something low maintenance (aluminium) or are you happy with a bit of care for that premium teak look?"
        ]
    };
    
    const options = questions[qualificationType] || questions['seats'];
    return options[Math.floor(Math.random() * options.length)];
}

// ============================================
// SECTION 5: PERSONA QUESTIONS
// ============================================

const questionVariations = {
    material: {
        default: [
            "What material appeals to you most - teak, aluminium, or rattan?",
            "Which material would work best for your space - teak, aluminium, or rattan?",
            "Are you drawn to any particular material like teak, aluminium, or rattan?"
        ],
        entertainer: [
            "For hosting guests, which material creates the impression you want - elegant teak, modern aluminium, or classic rattan?",
            "When entertaining, what material fits your style - sophisticated teak, sleek aluminium, or welcoming rattan?"
        ],
        family: [
            "With family use in mind, which low-maintenance material suits you - durable teak, easy-clean aluminium, or comfortable rattan?",
            "For family life, which practical material works best - weather-resistant teak, rust-proof aluminium, or cozy rattan?"
        ]
    },
    furnitureType: {
        default: [
            "Are you looking for dining furniture or lounge furniture?",
            "Would you prefer dining sets or lounge seating?"
        ],
        entertainer: [
            "Are you planning more formal dining experiences or casual lounge gatherings?",
            "Would you prioritize impressive dining sets or comfortable lounge areas for guests?"
        ]
    },
    seatCount: {
        default: [
            "How many people do you typically need to seat?",
            "What's the seating capacity you're looking for?"
        ],
        entertainer: [
            "What's the largest group you typically entertain?",
            "How many guests do you usually host at once?"
        ],
        family: [
            "How many family members need seating?",
            "What's your family size for planning seating?"
        ]
    }
};

function getPersonaAwareQuestion(type, persona = 'default', usedQuestions = []) {
    const variations = questionVariations[type] || {};
    const personaQuestions = variations[persona] || variations.default || [];
    const allQuestions = [...personaQuestions, ...(variations.default || [])];
    
    const unused = allQuestions.filter(q => !usedQuestions.includes(q));
    
    if (unused.length === 0) {
        return allQuestions[Math.floor(Math.random() * allQuestions.length)];
    }
    
    return unused[Math.floor(Math.random() * unused.length)];
}

function getNextQualifyingQuestion(state, conversationHistory) {
    if (state.purpose || state.capacity || state.material ||
        conversationHistory.length > 2 ||
        state.qualified || state.askedOpener) {
        state.qualified = true;
        return null;
    }
    
    const conversationalOpeners = [
        "What's bringing you to MINT today - dining or lounging?",
        "Are you dreaming of dinner parties or lazy Sunday lounging?",
        "Tell me about your perfect outdoor setup!",
        "What kind of outdoor moments are you looking to create?",
        "Is this for entertaining friends or family relaxation?"
    ];
    
    const index = new Date().getSeconds() % conversationalOpeners.length;
    state.askedOpener = true;
    
    return conversationalOpeners[index];
}

// ============================================
// SECTION 6: ENGAGEMENT TRACKING
// ============================================

function initializeSessionTracking(session) {
    if (!session.context.tracking) {
        session.context.tracking = {
            startTime: Date.now(),
            productsViewed: [],
            questionsAsked: 0,
            engagementLevel: 'browsing',
            lastActivity: Date.now()
        };
    }
}

function updateEngagementLevel(session, action, data) {
    if (!session.context.tracking) {
        initializeSessionTracking(session);
    }
    
    const tracking = session.context.tracking;
    tracking.lastActivity = Date.now();
    
    if (action === 'viewed_product') {
        tracking.productsViewed.push(data);
        if (tracking.productsViewed.length >= 2) {
            tracking.engagementLevel = 'interested';
        }
        if (tracking.productsViewed.length >= 4) {
            tracking.engagementLevel = 'highly_engaged';
        }
    }
    
    if (action === 'asked_specific') {
        tracking.engagementLevel = 'qualified';
    }
    
    if (action === 'showed_buying_signal') {
        tracking.engagementLevel = 'ready_to_buy';
    }
    
    console.log(`📊 Engagement: ${tracking.engagementLevel}`);
    return tracking.engagementLevel;
}

function trackCustomerEducation(session, topic) {
    if (!session.context.educationProgress) {
        session.context.educationProgress = {
            materials: false,
            warranty: false,
            maintenance: false,
            dimensions: false,
            assembly: false,
            educated: false
        };
    }
    
    session.context.educationProgress[topic] = true;
    
    const educatedTopics = Object.values(session.context.educationProgress).filter(Boolean).length;
    session.context.educationProgress.educated = educatedTopics >= 1;
    
    console.log(`📚 Education progress: ${educatedTopics}/5 topics covered`);
    return session.context.educationProgress.educated;
}

// ============================================
// SECTION 7: EMAIL SYSTEM
// ============================================

async function sendChatToMarketing(sessionId, reason, conversationHistory, customerDetails = null) {
    const session = sessions.get(sessionId);
    
    // Extract email from conversation if not provided
    if (!customerDetails || !customerDetails.email) {
        conversationHistory.forEach(msg => {
            if (msg.role === 'user') {
                const emailMatch = msg.content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
                if (emailMatch && (!customerDetails || !customerDetails.email)) {
                    customerDetails = customerDetails || {};
                    customerDetails.email = emailMatch[0];
                }
            }
        });
    }
    
    // Format conversation
    let chatTranscript = '\n=== CHAT TRANSCRIPT ===\n';
    conversationHistory.forEach((msg, index) => {
        if (msg.role === 'user') {
            chatTranscript += `\n[CUSTOMER]: ${msg.content}\n`;
        } else if (msg.role === 'assistant') {
            chatTranscript += `[GWEN]: ${msg.content}\n`;
        }
    });
    chatTranscript += '\n=== END TRANSCRIPT ===\n';
    
    const customerEmail = customerDetails?.email || 'Not provided';
    const customerPostcode = customerDetails?.postcode || 'Not provided';
    
    let customerInfo = `
=== CUSTOMER DETAILS ===
Customer Email: ${customerEmail}
Postcode: ${customerPostcode}
Session ID: ${sessionId}
========================
    `;
    
    // Determine email priority
    let subject = 'Gwen AI - Customer Inquiry';
    let priority = 'Normal';
    
    const isDiscountRequest = reason.toLowerCase().includes('10% discount');
    const isBundleDiscount = reason.toLowerCase().includes('20% bundle');
    
    if (isBundleDiscount) {
        subject = `🎁 URGENT - 20% Bundle Discount Request - ${customerEmail}`;
        priority = 'High';
    } else if (isDiscountRequest) {
        subject = `💰 10% Discount Request - ${customerEmail}`;
        priority = 'High';
    } else if (reason.toLowerCase().includes('bundle') || reason.toLowerCase().includes('purchase')) {
        subject = `🎯 HIGH PRIORITY - Customer Ready to Purchase - ${customerEmail}`;
        priority = 'High';
    } else if (customerDetails?.email) {
        subject = `📞 Customer Inquiry - ${customerEmail}`;
    }
    
    // Create HTML email
    const emailHTML = `
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #9FDCC2, #2E6041); color: white; padding: 20px; text-align: center;">
            <h1>🌿 MINT Outdoor - Gwen AI Handoff</h1>
            <p style="margin: 0; font-size: 18px; font-weight: bold;">${reason}</p>
        </div>
        
        <div style="padding: 20px; background: ${isBundleDiscount ? '#fff3cd' : (isDiscountRequest ? '#d1ecf1' : '#f8f9fa')}; border-left: 5px solid ${isBundleDiscount ? '#ffc107' : (isDiscountRequest ? '#0dcaf0' : '#6c757d')};">
            ${isBundleDiscount ? '<h2 style="color: #856404; margin-top: 0;">⚡ 20% BUNDLE DISCOUNT REQUESTED</h2>' : ''}
            ${isDiscountRequest && !isBundleDiscount ? '<h2 style="color: #055160; margin-top: 0;">💰 10% DISCOUNT REQUESTED</h2>' : ''}
            
            <p style="margin: 5px 0; font-size: 18px; font-weight: bold;">
                📧 Customer Email: <span style="color: #2E6041;">${customerEmail}</span>
            </p>
            ${customerDetails?.postcode ?
                `<p style="margin: 5px 0; font-size: 16px;">📍 Postcode: ${customerDetails.postcode}</p>` : ''
            }
            <p style="margin: 5px 0;">🆔 Session ID: ${sessionId}</p>
            <p style="margin: 5px 0;">⏰ Timestamp: ${new Date().toLocaleString('en-GB')}</p>
            
            ${isBundleDiscount ?
                '<p style="background: #ffc107; padding: 10px; border-radius: 5px; margin-top: 15px;"><strong>ACTION REQUIRED:</strong> Send payment link with 20% discount applied to bundle</p>'
                : ''}
            ${isDiscountRequest && !isBundleDiscount ?
                '<p style="background: #0dcaf0; padding: 10px; border-radius: 5px; margin-top: 15px;"><strong>ACTION REQUIRED:</strong> Send payment link with 10% discount applied</p>'
                : ''}
        </div>
        
        <div style="padding: 20px;">
            <h2>Conversation History</h2>
            <pre style="white-space: pre-wrap; font-family: Consolas, monospace; background: #f4f4f4; padding: 15px; border-radius: 5px; max-height: 500px; overflow-y: auto;">
${chatTranscript}
            </pre>
        </div>
        
        <div style="background: #2E6041; color: white; padding: 15px; text-align: center; margin-top: 20px;">
            <p style="margin: 0;">⚡ Respond within 2 hours for best conversion rate</p>
        </div>
    </body>
    </html>
    `;
    
    const mailOptions = {
        from: `"MINT Outdoor - Gwen AI" <${process.env.EMAIL_USER}>`,
        to: ESCALATION_EMAILS.join(', '),
        subject: subject,
        html: emailHTML,
        priority: priority.toLowerCase(),
        headers: {
            'X-Priority': priority === 'High' ? '1' : '3',
            'X-Customer-Email': customerDetails?.email || 'not-provided',
            'X-Discount-Type': isBundleDiscount ? '20-percent-bundle' : (isDiscountRequest ? '10-percent' : 'none')
        }
    };
    
    try {
        console.log('\n📧 ========== SENDING ESCALATION EMAIL ==========');
        console.log(`📋 To: ${ESCALATION_EMAILS.join(', ')}`);
        console.log(`👤 Customer Email: ${customerDetails?.email || 'Not captured'}`);
        console.log(`📋 Subject: ${subject}`);
        
        const info = await emailTransporter.sendMail(mailOptions);
        
        console.log('✅ EMAIL SENT SUCCESSFULLY!');
        console.log(`📧 Message ID: ${info.messageId}`);
        
        // Log handoff event for analytics
        await logEvent(sessionId, 'handoff_triggered', {
            reason: reason,
            customerEmail: customerEmail,
            discountType: isBundleDiscount ? '20%' : (isDiscountRequest ? '10%' : 'none')
        });
        await updateSessionSummary(sessionId, { handoff_triggered: true });
        
        return true;
        
    } catch (error) {
        console.error('❌ EMAIL SENDING FAILED:', error.message);
        
        console.log('\n📝 ========== BACKUP LOG (Email Failed) ==========');
        console.log(`📋 Reason: ${reason}`);
        console.log(`👤 Customer Email: ${customerDetails?.email || 'Not captured'}`);
        console.log(`🆔 Session ID: ${sessionId}`);
        console.log(chatTranscript);
        
        return false;
    }
}

// ============================================
// SECTION 8: PRODUCT SEARCH FUNCTIONS
// ============================================

function detectProductType(product) {
    const title = product.product_title?.toLowerCase() || '';
    if (title.includes('corner')) return 'corner';
    if (title.includes('dining')) return 'dining';
    if (title.includes('lounger') || title.includes('sunbed')) return 'lounger';
    if (title.includes('lounge') || title.includes('sofa')) return 'lounge';
    return 'unknown';
}

function isCompatibleType(type1, type2) {
    const compatible = {
        'lounge': ['corner'],
        'corner': ['lounge'],
        'dining': []
    };
    return compatible[type1]?.includes(type2) || false;
}

function getProductSeats(sku) {
    const product = productIndex.bySku[sku];
    return product?.specifications?.seats ? parseInt(product.specifications.seats) : 0;
}

function getProductMaterials(sku) {
    const product = productIndex.bySku[sku];
    if (!product?.materials_and_care) return [];
    return product.materials_and_care.map(m => m.name);
}

function getStockStatus(sku) {
    if (inventoryData && Array.isArray(inventoryData) && inventoryData.length > 0) {
        const stockInfo = inventoryData.find(item => item.sku === sku);
        
        if (stockInfo) {
            const available = parseInt(stockInfo.available) || 0;
            const inStock = available > 0;
            
            let stockMessage = '';
            if (available > 60) {
                stockMessage = '⚠️ Low stock - this is a bestseller';
            } else if (available >= 20 && available <= 60) {
                stockMessage = `⚠️ Only ${available} left in stock`;
            } else if (available < 20 && available > 0) {
                stockMessage = `🚨 URGENT: Only ${available} remaining - next shipment 8+ weeks`;
            } else {
                stockMessage = '❌ Currently out of stock - next shipment 8+ weeks';
            }
            
            return {
                inStock: inStock,
                stockLevel: available,
                message: stockMessage,
                urgency: available < 60 ? 'high' : 'medium'
            };
        }
    }
    
    const product = productIndex.bySku[sku];
    if (product?.logistics_and_inventory?.inventory) {
        const inv = product.logistics_and_inventory.inventory;
        const available = parseInt(inv.available) || 0;
        
        let stockMessage = '';
        if (available > 60) {
            stockMessage = '⚠️ Low stock - this is a bestseller';
        } else if (available >= 20 && available <= 60) {
            stockMessage = `⚠️ Only ${available} left in stock`;
        } else if (available < 20 && available > 0) {
            stockMessage = `🚨 URGENT: Only ${available} remaining - next shipment 8+ weeks`;
        } else {
            stockMessage = '❌ Currently out of stock - next shipment 8+ weeks';
        }
        
        return {
            inStock: available > 0,
            stockLevel: available,
            message: stockMessage,
            urgency: available < 60 ? 'high' : 'medium',
            lowStockWarning: inv.low_stock_warning
        };
    }
    
    return {
        inStock: true,
        stockLevel: 'unknown',
        message: '✓ Available - contact for current stock status',
        urgency: 'low'
    };
}

function findAccessoriesForProduct(mainProductSku) {
    const accessories = [];
    
    if (!bundleItems || !bundleSuggestions) return accessories;
    
    const relevantBundleIds = bundleItems
        .filter(item => item.product_sku === mainProductSku)
        .map(item => item.bundle_id);
    
    if (relevantBundleIds.length === 0) return accessories;
    
    const addedSkus = new Set();
    
    for (const bundleId of relevantBundleIds) {
        const bundle = bundleSuggestions.find(b => b.bundle_id === bundleId);
        if (!bundle) continue;
        
        const bundleAccessories = bundleItems.filter(item =>
            item.bundle_id === bundleId && item.product_sku !== mainProductSku
        );
        
        for (const item of bundleAccessories) {
            if (addedSkus.has(item.product_sku)) continue;
            
            const accProduct = productIndex.bySku[item.product_sku];
            if (accProduct) {
                accessories.push({
                    sku: item.product_sku,
                    name: accProduct.product_identity?.product_name || item.product_sku,
                    price: accProduct.product_identity?.price || 'Check price',
                    benefit: bundle.description || 'Recommended accessory'
                });
                addedSkus.add(item.product_sku);
            }
        }
    }
    
    return accessories.slice(0, 3);
}

function enrichProductWithCompatibleData(product) {
    const sku = product.product_identity?.sku;
    if (!sku) return null;
    
    const stockStatus = getStockStatus(sku);
    const accessories = findAccessoriesForProduct(sku);
    
    const localPrice = product.product_identity?.price ||
        product.product_identity?.rrp ||
        'Contact for pricing';
    
    return {
        sku: sku,
        product_title: product.product_identity?.product_name,
        price: localPrice,
        website_url: product.product_identity?.url || `https://mint-outdoor.com/search?q=${sku}`,
        image_url: product.product_identity?.image_url || null,
        stockStatus: stockStatus,
        category: product.description_and_category?.primary_category,
        material: product.description_and_category?.material_type,
        seats: product.specifications?.seats,
        dimensions: product.specifications?.dimensions_cm,
        assembly_required: product.specifications?.assembly?.required === "Yes",
        accessories: accessories,
        hasAccessories: accessories.length > 0,
        totalBundlePrice: accessories.length > 0 ?
            (parseFloat(localPrice) + accessories.reduce((sum, acc) => sum + parseFloat(acc.price), 0)).toFixed(2) :
            null
    };
}

function searchRealProducts(criteria) {
    if (!productKnowledgeCenter || productKnowledgeCenter.length === 0) {
        console.log('❌ No product data available');
        return [];
    }
    
    const { material, furnitureType, seatCount, productName, sku, maxResults = 3, includeOutOfStock = false } = criteria;
    let filtered = [...productKnowledgeCenter].filter(p =>
        p.product_identity?.sku &&
        p.description_and_category?.primary_category
    );
    
    // Direct SKU lookup
    if (sku) {
        const exactMatch = productIndex.bySku[sku];
        if (exactMatch) {
            console.log(`✅ Direct SKU match: ${sku}`);
            return [enrichProductWithCompatibleData(exactMatch)].filter(Boolean);
        }
    }
    
    // Name search with fuzzy matching
    if (productName) {
        const searchTerms = productName.toLowerCase().split(/\s+/);
        filtered = filtered.filter(p => {
            const productTitle = p.product_identity?.product_name?.toLowerCase() || '';
            const productSku = p.product_identity?.sku?.toLowerCase() || '';
            return searchTerms.some(term =>
                productTitle.includes(term) || productSku.includes(term)
            );
        });
        console.log(`🔍 Name search for "${productName}": ${filtered.length} matches`);
    }
    
    // Filter by furniture type
    if (furnitureType) {
        filtered = filtered.filter(p => {
            const category = p.description_and_category?.primary_category?.toLowerCase() || '';
            const taxonomy = p.description_and_category?.taxonomy_type?.toLowerCase() || '';
            const title = p.product_identity?.product_name?.toLowerCase() || '';
            
            const typeMatches = {
                'dining': ['dining', 'table', 'chair'],
                'lounge': ['lounge', 'sofa', 'seating'],
                'corner': ['corner', 'sectional', 'l-shape'],
                'lounger': ['lounger', 'sunbed', 'daybed']
            };
            
            const keywords = typeMatches[furnitureType.toLowerCase()] || [furnitureType.toLowerCase()];
            return keywords.some(kw =>
                category.includes(kw) || taxonomy.includes(kw) || title.includes(kw)
            );
        });
        console.log(`📂 Type filter "${furnitureType}": ${filtered.length} matches`);
    }
    
    // Filter by material
    if (material) {
        filtered = filtered.filter(p => {
            const materialType = p.description_and_category?.material_type?.toLowerCase() || '';
            const title = p.product_identity?.product_name?.toLowerCase() || '';
            return materialType.includes(material.toLowerCase()) ||
                title.includes(material.toLowerCase());
        });
        console.log(`🎨 Material filter "${material}": ${filtered.length} matches`);
    }
    
    // Filter by seat count with flexibility
    if (seatCount) {
        const targetSeats = parseInt(seatCount);
        filtered = filtered.filter(p => {
            const seats = parseInt(p.specifications?.seats);
            if (isNaN(seats)) return false;
            return Math.abs(seats - targetSeats) <= 1;
        });
        console.log(`🪑 Seat filter "${seatCount}": ${filtered.length} matches`);
    }
    
    // Enrich all matches first
    let enriched = filtered
        .map(p => enrichProductWithCompatibleData(p))
        .filter(Boolean);
    
    // ============================================
    // CRITICAL: Filter out unsellable products
    // ============================================
    
    const beforeFilter = enriched.length;
    
    // Filter out products with no valid price
    enriched = enriched.filter(p => {
        const price = p.price;
        const hasValidPrice = price && 
            price !== 'Contact for pricing' && 
            price !== 'Check price' &&
            !price.includes('Contact');
        if (!hasValidPrice) {
            console.log(`⚠️ Excluding ${p.sku}: No valid price (${price})`);
        }
        return hasValidPrice;
    });
    
    // Filter out out-of-stock products (unless specifically requested)
    if (!includeOutOfStock) {
        enriched = enriched.filter(p => {
            const inStock = p.stockStatus?.inStock !== false;
            if (!inStock) {
                console.log(`⚠️ Excluding ${p.sku}: Out of stock`);
            }
            return inStock;
        });
    }
    
    console.log(`✅ After availability filter: ${enriched.length} sellable products (from ${beforeFilter})`);
    
    // Sort by stock level (higher stock = more confidence) and price availability
    enriched.sort((a, b) => {
        // Prioritize products with known stock levels
        const stockA = typeof a.stockStatus?.stockLevel === 'number' ? a.stockStatus.stockLevel : 50;
        const stockB = typeof b.stockStatus?.stockLevel === 'number' ? b.stockStatus.stockLevel : 50;
        return stockB - stockA; // Higher stock first
    });
    
    // If we filtered everything out, log a warning
    if (enriched.length === 0 && beforeFilter > 0) {
        console.log(`🚨 WARNING: All ${beforeFilter} matches were excluded (no price or out of stock)`);
    }
    
    return enriched.slice(0, maxResults);
}

async function getShopifyProductBySku(sku) {
    if (!SHOPIFY_ACCESS_TOKEN) return null;
    
    try {
        const response = await fetch(
            `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?limit=250`,
            {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!response.ok) {
            console.log(`⚠️ Shopify API returned status ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        const products = data.products || [];
        
        for (const product of products) {
            const variant = product.variants.find(v => v.sku === sku);
            if (variant) {
                return {
                    price: variant.price,
                    url: `https://mint-outdoor.com/products/${product.handle}`,
                    variant_id: variant.id,
                    inventory_quantity: variant.inventory_quantity,
                    available: variant.available,
                    image_url: product.images[0]?.src || null
                };
            }
        }
        
        return null;
    } catch (error) {
        console.error(`Shopify fetch failed for ${sku}:`, error);
        return null;
    }
}

async function searchShopifyProducts(criteria) {
    try {
        console.log('🛒 Enhanced Shopify search...');
        console.log('🔍 Search criteria:', criteria);
        
        // Get local results (with basic filtering)
        // Pass includeOutOfStock=true because Shopify will give us real stock data
        const modifiedCriteria = { ...criteria, includeOutOfStock: true };
        let localResults = searchRealProducts(modifiedCriteria);
        
        // Enrich with Shopify data (real prices and stock)
        for (let product of localResults) {
            const shopifyData = await getShopifyProductBySku(product.sku);
            if (shopifyData) {
                // Update price from Shopify (real-time)
                if (shopifyData.price && parseFloat(shopifyData.price) > 0) {
                    product.price = `£${parseFloat(shopifyData.price).toFixed(2)}`;
                    product.hasValidPrice = true;
                }
                if (shopifyData.url) {
                    product.website_url = shopifyData.url;
                }
                product.variant_id = shopifyData.variant_id;
                product.image_url = shopifyData.image_url || product.image_url;
                
                // Update stock from Shopify (real-time)
                if (shopifyData.inventory_quantity !== undefined) {
                    const qty = shopifyData.inventory_quantity;
                    product.stockStatus = {
                        inStock: qty > 0,
                        stockLevel: qty,
                        message: qty > 60 ? '⚠️ Low stock - this is a bestseller' :
                                 qty >= 20 ? `⚠️ Only ${qty} left in stock` :
                                 qty > 0 ? `🚨 URGENT: Only ${qty} remaining - next shipment 8+ weeks` :
                                 '❌ Currently out of stock - next shipment 8+ weeks',
                        urgency: qty < 60 ? 'high' : 'medium'
                    };
                }
            }
            if (!product.website_url) {
                product.website_url = `https://mint-outdoor.com/search?q=${product.sku}`;
            }
        }
        
        // ============================================
        // FINAL FILTER: Remove unsellable products
        // ============================================
        const beforeFilter = localResults.length;
        const filteredOutProducts = [];
        
        // Remove products without valid prices
        localResults = localResults.filter(p => {
            const price = p.price;
            const hasValidPrice = price && 
                price !== 'Contact for pricing' && 
                price !== 'Check price' &&
                !price.includes('Contact');
            if (!hasValidPrice) {
                console.log(`🚫 FINAL FILTER: Excluding ${p.sku} - No valid price (${price})`);
                filteredOutProducts.push({ sku: p.sku, name: p.product_title, reason: 'no_price', price: price });
            }
            return hasValidPrice;
        });
        
        // Remove out of stock products
        localResults = localResults.filter(p => {
            const inStock = p.stockStatus?.inStock !== false && p.stockStatus?.stockLevel !== 0;
            if (!inStock) {
                console.log(`🚫 FINAL FILTER: Excluding ${p.sku} - Out of stock (${p.stockStatus?.stockLevel} available)`);
                filteredOutProducts.push({ sku: p.sku, name: p.product_title, reason: 'out_of_stock', stock: p.stockStatus?.stockLevel });
            }
            return inStock;
        });
        
        // Log filtered products summary for business intelligence
        if (filteredOutProducts.length > 0) {
            console.log(`\n📊 INVENTORY ALERT: ${filteredOutProducts.length} products excluded from results:`);
            filteredOutProducts.forEach(p => {
                console.log(`   - ${p.name} (${p.sku}): ${p.reason === 'no_price' ? 'Missing price' : 'Out of stock'}`);
            });
            console.log('');
        }
        
        console.log(`✅ Final results: ${localResults.length} sellable products (filtered ${beforeFilter - localResults.length})`);
        
        // Sort by stock level (higher = better)
        localResults.sort((a, b) => {
            const stockA = typeof a.stockStatus?.stockLevel === 'number' ? a.stockStatus.stockLevel : 50;
            const stockB = typeof b.stockStatus?.stockLevel === 'number' ? b.stockStatus.stockLevel : 50;
            return stockB - stockA;
        });
        
        return localResults.slice(0, criteria.maxResults || 3);
    } catch (error) {
        console.error('❌ Shopify search failed:', error.message);
        return searchRealProducts(criteria);
    }
}

// ============================================
// SECTION 9: BUNDLE SYSTEM
// ============================================

async function findBundleRecommendations(mainProductSku) {
    console.log(`\n🔎 [Bundle System] Starting search for SKU: "${mainProductSku}"`);
    
    if (!bundleSuggestions || !bundleItems) {
        console.log('❌ [Bundle System] Error: Bundle data not available.');
        return [];
    }
    
    try {
        const relevantBundleIds = bundleItems
            .filter(item => item.product_sku === mainProductSku)
            .map(item => item.bundle_id);
        
        if (relevantBundleIds.length === 0) {
            console.log(`🤷 [Bundle System] No bundles list the SKU "${mainProductSku}".`);
            return [];
        }
        
        const relevantBundles = bundleSuggestions.filter(bundle =>
            relevantBundleIds.includes(bundle.bundle_id)
        );
        const recommendations = [];
        const addedSkus = new Set();
        
        for (const bundle of relevantBundles) {
            console.log(`\n🎁 [Bundle System] Processing bundle: "${bundle.name}"`);
            const bundleAccessoryItems = bundleItems.filter(item =>
                item.bundle_id === bundle.bundle_id && item.product_sku !== mainProductSku
            );
            
            for (const item of bundleAccessoryItems) {
                if (addedSkus.has(item.product_sku)) continue;
                
                console.log(`    - Looking for accessory SKU "${item.product_sku}"...`);
                
                const shopifyProducts = await searchShopifyProducts({ sku: item.product_sku, maxResults: 1 });
                
                if (shopifyProducts && shopifyProducts.length > 0) {
                    const product = shopifyProducts[0];
                    console.log(`    ✅ SUCCESS: Found "${product.product_title}" with price ${product.price}`);
                    
                    recommendations.push({
                        ...product,
                        bundle_name: bundle.name,
                        bundle_description: bundle.description
                    });
                    addedSkus.add(item.product_sku);
                } else {
                    console.log(`    ❌ FAILED: Accessory SKU "${item.product_sku}" not found`);
                }
            }
        }
        
        console.log(`\n🎉 [Bundle System] Found ${recommendations.length} unique accessory recommendations.`);
        return recommendations.slice(0, 3);
        
    } catch (error) {
        console.error('💥 [Bundle System] Error:', error.message);
        return [];
    }
}

function createCompleteOutdoorRoomBundle(mainProduct, category) {
    const bundlesByCategory = {
        'dining-set': {
            name: 'Complete Outdoor Dining Experience',
            accessories: ['parasol', 'cushions', 'furniture-cover', 'side-table'],
            theme: 'dining room',
            socialProof: '87% of customers complete their outdoor dining setup with these essentials'
        },
        'lounge-set': {
            name: 'Complete Outdoor Lounge Haven',
            accessories: ['cushions', 'weather-cover', 'ottoman', 'side-table'],
            theme: 'lounge area',
            socialProof: '83% of customers create the perfect relaxation space with these additions'
        },
        'corner-set': {
            name: 'Complete Corner Garden Suite',
            accessories: ['weather-cover', 'throw-pillows', 'drinks-table'],
            theme: 'corner retreat',
            socialProof: '91% of corner set buyers protect their investment with covers'
        }
    };
    
    return bundlesByCategory[category] || bundlesByCategory['lounge-set'];
}

// ============================================
// SECTION 10: AI TOOLS DEFINITIONS
// ============================================

const aiTools = [
    {
        type: "function",
        function: {
            name: "search_products",
            description: "Search for REAL products in our inventory by criteria OR specific product name/SKU.",
            parameters: {
                type: "object",
                properties: {
                    productName: {
                        type: "string",
                        description: "Specific product name or keyword to search for"
                    },
                    furnitureType: {
                        type: "string",
                        enum: ["dining", "lounge", "corner", "lounger"],
                        description: "Type of furniture"
                    },
                    material: {
                        type: "string",
                        description: "Material preference (teak, aluminium, rattan)"
                    },
                    seatCount: {
                        type: "integer",
                        description: "Number of seats needed"
                    },
                    sku: {
                        type: "string",
                        description: "Exact SKU to search for"
                    },
                    maxResults: {
                        type: "integer",
                        description: "Maximum number of results (default 3)"
                    },
                    maxPrice: {
                        type: "number",
                        description: "Maximum price filter"
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_product_availability",
            description: "Check real-time stock status for a specific product SKU.",
            parameters: {
                type: "object",
                properties: {
                    sku: {
                        type: "string",
                        description: "The SKU of the product to check."
                    }
                },
                required: ["sku"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_comprehensive_warranty",
            description: "Get detailed warranty information for a product",
            parameters: {
                type: "object",
                properties: {
                    sku: {
                        type: "string",
                        description: "Product SKU for warranty information"
                    },
                    query_type: {
                        type: "string",
                        enum: ["full_breakdown", "summary", "material_specific"],
                        description: "Type of warranty information needed"
                    }
                },
                required: ["sku"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_material_expertise",
            description: "Get comprehensive information about materials",
            parameters: {
                type: "object",
                properties: {
                    material: {
                        type: "string",
                        enum: ["teak", "aluminium", "rattan", "olefin", "polyester"],
                        description: "Material to get expertise about"
                    },
                    query_type: {
                        type: "string",
                        enum: ["maintenance", "properties", "climate", "all"],
                        description: "Type of information needed"
                    }
                },
                required: ["material"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_product_dimensions",
            description: "Get detailed dimensions and assembly information",
            parameters: {
                type: "object",
                properties: {
                    sku: {
                        type: "string",
                        description: "Product SKU to get dimensions for"
                    }
                },
                required: ["sku"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_fabric_expertise",
            description: "Get detailed information about outdoor fabric types",
            parameters: {
                type: "object",
                properties: {
                    fabric_type: {
                        type: "string",
                        enum: ["sunbrella", "olefin", "polyester", "acrylic"],
                        description: "Fabric type to get information about"
                    }
                },
                required: ["fabric_type"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_seasonal_advice",
            description: "Get seasonal recommendations for outdoor furniture",
            parameters: {
                type: "object",
                properties: {
                    season: {
                        type: "string",
                        enum: ["spring", "summer", "autumn", "winter"],
                        description: "Season to get advice for"
                    }
                },
                required: ["season"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "offer_package_deal",
            description: "Offer bundle package deal when customer shows strong interest",
            parameters: {
                type: "object",
                properties: {
                    productSku: {
                        type: "string",
                        description: "SKU of the product customer is interested in"
                    },
                    reason: {
                        type: "string",
                        description: "Why offering bundle now"
                    }
                },
                required: ["productSku"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "offer_bundle_naturally",
            description: "Offer bundle deals when customer has seen products and asked questions",
            parameters: {
                type: "object",
                properties: {
                    mainProductSku: {
                        type: "string",
                        description: "SKU of the product customer is interested in"
                    },
                    productCategory: {
                        type: "string",
                        enum: ["dining-set", "lounge-set", "corner-set", "teak-furniture"],
                        description: "Category of the main product"
                    }
                },
                required: ["mainProductSku", "productCategory"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "marketing_handoff",
            description: "Send customer conversation to marketing team for purchase or assistance",
            parameters: {
                type: "object",
                properties: {
                    reason: {
                        type: "string",
                        description: "Reason for handoff"
                    }
                },
                required: ["reason"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_faq_answer",
            description: "Get answers to frequently asked questions",
            parameters: {
                type: "object",
                properties: {
                    question_keyword: {
                        type: "string",
                        description: "Keyword from the customer's question"
                    }
                },
                required: ["question_keyword"]
            }
        }
    }
];

// ============================================
// SECTION 11: AI RESPONSE GENERATOR
// ============================================

async function generateAISalesResponse(message, sessionId, session) {
    if (!ENABLE_SALES_MODE) {
        return "I'd be happy to help you with any questions about MINT Outdoor furniture or your orders. How can I assist you today?";
    }
    
    try {
        const conversation = session.conversationHistory || [];
        const lowerMessage = message.toLowerCase();
        
        // Detect and log customer persona
        const customerPersona = detectCustomerPersona(conversation);
        session.context.detectedPersona = customerPersona;
        console.log(`🎭 Detected customer persona: ${customerPersona}`);
        
        // SMART QUERY ANALYSIS - Detect what info we have vs need
        const queryAnalysis = analyzeQueryCompleteness(conversation, message);
        console.log(`🔍 Query Analysis: ${queryAnalysis.summary}`);
        console.log(`📊 Ready to show products: ${queryAnalysis.readyToShowProducts}`);
        console.log(`❓ Qualification needed: ${queryAnalysis.qualificationNeeded || 'none'}`);
        
        // Store gathered info in session context
        session.context.gatheredInfo = {
            ...session.context.gatheredInfo,
            ...queryAnalysis.gathered
        };
        
        // Log persona detection event
        if (conversation.length === 1) {
            await logEvent(sessionId, 'persona_detected', { persona: customerPersona });
            await updateSessionSummary(sessionId, { persona_detected: customerPersona });
        }
        
        // Log query analysis for analytics
        await logEvent(sessionId, 'query_analyzed', {
            ready_to_show: queryAnalysis.readyToShowProducts,
            qualification_needed: queryAnalysis.qualificationNeeded,
            info_count: queryAnalysis.infoCount,
            specific_product: queryAnalysis.isSpecificProduct,
            gathered: queryAnalysis.summary
        });
        
        // Generate smart qualification guidance for AI
        let qualificationGuidance = '';
        if (queryAnalysis.isSpecificProduct) {
            qualificationGuidance = `
🎯 SPECIFIC PRODUCT REQUESTED - Show it immediately! Customer asked for a specific product by name.
DO NOT ask qualifying questions. Use search_products to find and display the requested product NOW.`;
        } else if (queryAnalysis.readyToShowProducts) {
            qualificationGuidance = `
🎯 READY TO SHOW PRODUCTS - We have enough info to make recommendations.
Gathered info: ${queryAnalysis.summary}
Use search_products NOW with these criteria and show 2-3 relevant options.`;
        } else {
            const smartQuestion = getSmartQualificationQuestion(queryAnalysis.qualificationNeeded, queryAnalysis.gathered.purpose);
            qualificationGuidance = `
🎯 NEED ONE QUALIFYING QUESTION - Ask this naturally, then show products in your NEXT response.
Missing: ${queryAnalysis.missing.join(', ')}
Suggested question: "${smartQuestion}"

IMPORTANT: Ask ONLY this ONE question. Do NOT interrogate with multiple questions.
After they answer, IMMEDIATELY show products - don't ask more questions.`;
        }
        
        const messages = [{
            role: "system",
            content: `You are Gwen, an outdoor furniture expert at MINT Outdoor.

${qualificationGuidance}

🧠 SMART QUALIFICATION RULES:

1. **SPECIFIC PRODUCT REQUEST** (customer mentions "Barcelona", "Palma", etc.)
   → Show that product IMMEDIATELY. No questions needed.

2. **HAVE 2+ PIECES OF INFO** (e.g., seats + material, or purpose + seats)
   → Show products IMMEDIATELY. No questions needed.
   
3. **VAGUE REQUEST** ("do you have lounge furniture?", "what dining sets do you have?")
   → Ask ONE smart question about what's missing (usually seats or material)
   → Then show products in your NEXT response
   
4. **NEVER ask more than ONE qualifying question per response**

5. **By message 3, you MUST be showing products** - no more questions after that

📋 WHEN SHOWING PRODUCTS - USE THIS FORMAT:

**[Product Name]**
[image_display field here]

✨ [Emotional hook based on seat count: "Picture hosting 9 friends for summer BBQs..."]

💪 **Why customers love this:**
- [Use verified_features - real material benefits]
- [Maintenance ease]
- [Warranty info from actual_warranties]

💰 Price: [price_display field]
📦 [stock_display field]

[view_button field]

---

🎁 **BUNDLE SECTION - ONLY SHOW IF product.hasAccessories = true:**

⚠️ CHECK FIRST: Does the product have hasAccessories: true AND accessories array with items?
- If YES → Show the bundle offer below
- If NO → DO NOT show any bundle offer. Just ask "What do you think of this option?"

**ONLY IF hasAccessories = true, show this:**

COMPLETE OUTDOOR SETUP - 20% OFF WHEN PURCHASED TOGETHER:

Most customers get the full protection package:
- [List ONLY the actual accessories from the product.accessories array]

💰 Bundle savings:
Set (£[actual_set_price]) + [Accessory names with actual prices from accessories array] = £[calculated_total]
**With 20% bundle discount = £[calculated_discounted_total]**
**YOU SAVE £[calculated_savings]!**

**Want the complete setup with 20% off? Just say 'yes' and give me your email.**

---

💬 **Closing question:**
- If bundle was shown: "This setup protects your investment for years - what do you think?"
- If NO bundle available: "What do you think? Any questions about the [material/warranty/delivery]?"

🚨 CRITICAL BUNDLE RULES:

1. **ONLY show bundle section if product.hasAccessories = true AND product.accessories.length > 0**
   - If hasAccessories is false or missing → DO NOT mention bundles at all
   - If accessories array is empty → DO NOT mention bundles at all

2. **ONLY use REAL accessories from the product.accessories array**
   - Never invent accessories like "cover" or "cushion box" unless they are IN the accessories array
   - Never show placeholder prices - only show prices from the accessories data

3. **Products WITHOUT bundles should focus on:**
   - Material quality and warranties
   - Stock urgency if low
   - Asking about their space/needs
   - Offering the 10% discount if they show price concern

4. **ALWAYS use pre-formatted fields:**
   - image_display (HTML img tag)
   - price_display (formatted price)
   - stock_display (stock message)
   - view_button (HTML button)

💰 DISCOUNT ESCALATION SYSTEM:

**For products WITHOUT bundles (hasAccessories = false):**
→ Offer 10% discount: "I can arrange 10% off if you're serious about this set - just need your email for the payment link."

**For products WITH bundles (hasAccessories = true AND customer interested in bundle):**
→ Offer 20% bundle discount: "Since you're getting the complete setup with accessories, you qualify for 20% off the TOTAL order. That's £[calculate_savings]! Your email address?"

**Price concern ("expensive", "discount", "cheaper") - ANY product:**
→ "I can arrange 10% off if you're serious about this set - just need your email for the payment link."

**When email provided:**
→ Use marketing_handoff tool with reason: "[discount type] discount - email: [email]"

⚠️ IMPORTANT: Only mention 20% discount if the product actually has bundles (hasAccessories = true). Otherwise, only offer 10%.

🎨 MATERIAL AUTO-RESPONSES:

**Rattan:** "This rattan is UV-tested to 2000 hours = guaranteed 3+ years of UK sun protection. Just cover during harsh winter storms."

**Aluminium:** "Zero maintenance - doesn't rust, doesn't rot, doesn't need treatment. Wipe with soapy water monthly."

**Teak:** "Teak naturally weathers to beautiful silver-grey, or oil annually to keep golden. Lasts 25+ years outdoors."

📊 STOCK URGENCY (Use product.stockStatus.message exactly as provided):
- Stock > 60: "⚠️ Low stock - bestseller"
- Stock 20-60: "⚠️ Only [X] left in stock"
- Stock < 20: "🚨 URGENT: Only [X] remaining - next shipment 8+ weeks"

🪑 SEAT CAPACITY UPSELL (Use ONCE if customer likes 6-seater or smaller):
"Perfect for everyday! Quick thought - when you have friends over for BBQs, do you find yourself squeezing people in? The [9-seater] is only £[difference] more."

⛔ BANNED PHRASES:
- "To help you find the perfect..."
- "I need to ask a few questions..."
- "Let me gather some information..."
- "What's your budget?" (too intrusive)

✅ REQUIRED STYLE:
- "Let me show you..."
- "You'll love this because..."
- ONLY say "Most customers grab the bundle deal..." IF hasAccessories = true

🔧 TOOLS:
- search_products: Find products by any criteria
- marketing_handoff: Send discount request (use after email capture)
- get_comprehensive_warranty: Detailed warranty info
- get_product_availability: Check stock levels

**Customer persona: ${customerPersona}**
${customerPersona === 'budget_conscious' ? '→ EMPHASIZE bundle savings in exact £' : ''}
${customerPersona === 'family' ? '→ EMPHASIZE protective covers and maintenance ease' : ''}
${customerPersona === 'entertainer' ? '→ EMPHASIZE complete setup and guest impressions' : ''}

📦 **CRITICAL PRODUCT DATA FIELDS:**
- image_display = Complete HTML
- price_display = Formatted price
- stock_display = Stock urgency message
- view_button = HTML button
- verified_features = Real benefits only
- actual_materials = Actual materials
- actual_warranties = Real warranty periods
- **accessories** = Array of upsell products (may be empty!)
- **hasAccessories** = If true, MUST show bundle. If false, NO bundle mention.

**Company Info:**
- Free UK delivery
- Assembly: £69.95
- 1-year guarantee + extended material warranties`
        },
            ...conversation.slice(-10),
            {
                role: "user",
                content: message
            }
        ];
        
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: messages,
            tools: aiTools,
            tool_choice: "auto",
            temperature: 0.4,
            max_tokens: 600
        });
        
        const aiMessage = response.choices[0].message;
        
        // Handle tool calls
        if (aiMessage.tool_calls) {
            let toolResults = [];
            
            for (const toolCall of aiMessage.tool_calls) {
                
                // SEARCH PRODUCTS HANDLER
                if (toolCall.function.name === "search_products") {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log('🔍 Search request:', args);
                    
                    const searchCriteria = {
                        ...args,
                        purpose: args.furnitureType || detectPurpose(session.conversationHistory, message),
                        capacity: args.seatCount || detectCapacity(session.conversationHistory, message),
                        material: args.material || detectMaterial(session.conversationHistory, message),
                        budget: args.maxPrice || detectBudget(session.conversationHistory, message)
                    };
                    
                    if (searchCriteria.purpose && !searchCriteria.furnitureType) {
                        const purposeMap = {
                            'dining': 'dining', 'lounge': 'lounge',
                            'corner': 'corner', 'lounger': 'lounger', 'hybrid': 'lounge'
                        };
                        searchCriteria.furnitureType = purposeMap[searchCriteria.purpose];
                    }
                    
                    if (searchCriteria.capacity && !searchCriteria.seatCount) {
                        searchCriteria.seatCount = searchCriteria.capacity;
                    }
                    
                    console.log('📊 Final search criteria:', searchCriteria);
                    
                    const products = await searchShopifyProducts(searchCriteria);
                    
                    if (products.length > 0) {
                        // Format products with verified data
                        const formattedProducts = products.map(product => {
                            const realFeatures = [];
                            const realWarranties = [];
                            const realMaterials = [];
                            
                            const actualProductData = productIndex.bySku[product.sku];
                            
                            if (actualProductData) {
                                if (actualProductData.materials_and_care) {
                                    actualProductData.materials_and_care.forEach(mat => {
                                        realMaterials.push(mat.name);
                                        if (mat.warranty) {
                                            realWarranties.push(`${mat.name}: ${mat.warranty}`);
                                        }
                                        if (mat.pros) {
                                            realFeatures.push(mat.pros);
                                        }
                                    });
                                }
                                
                                if (actualProductData.specifications) {
                                    if (actualProductData.specifications.seats) {
                                        realFeatures.push(`Seats ${actualProductData.specifications.seats} people`);
                                    }
                                    if (actualProductData.specifications.dimensions_cm) {
                                        const dims = actualProductData.specifications.dimensions_cm;
                                        realFeatures.push(`Dimensions: ${dims.width}x${dims.depth}x${dims.height}cm`);
                                    }
                                }
                            }
                            
                            return {
                                ...product,
                                sku: product.sku,
                                product_title: product.product_title,
                                price: product.price,
                                website_url: product.website_url,
                                image_display: product.image_url && product.website_url ?
                                    `<a href="${product.website_url}" target="_blank" style="display: block; text-decoration: none;"><img src="${product.image_url}" alt="${product.product_title}" style="max-width: 100%; border-radius: 8px; margin: 12px 0; cursor: pointer;"></a>` :
                                    '[No image available]',
                                price_display: product.price && product.price !== 'Check Shopify' ?
                                    product.price : 'Contact for pricing',
                                stock_display: product.stockStatus?.inStock ?
                                    `✓ In stock (${product.stockStatus.stockLevel} available)` :
                                    '⚠️ Currently out of stock',
                                view_button: product.website_url ?
                                    `<a href="${product.website_url}" target="_blank" style="display: inline-block; padding: 10px 20px; background-color: #2E6041; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 10px;">View in Store →</a>` :
                                    '<span style="color: #666;">Contact us for details</span>',
                                verified_features: realFeatures.length > 0 ? realFeatures.join(', ') : 'Premium outdoor furniture',
                                actual_materials: realMaterials.length > 0 ? realMaterials.join(', ') : 'High-quality materials',
                                actual_warranties: realWarranties.length > 0 ? realWarranties.join('; ') : '1 year standard warranty'
                            };
                        });
                        
                        // Log product display events for analytics
                        for (const product of formattedProducts) {
                            await logEvent(sessionId, 'product_displayed', {
                                sku: product.sku,
                                product_name: product.product_title,
                                price: product.price,
                                has_accessories: product.hasAccessories
                            });
                            await logProductInteraction(sessionId, product.sku, product.product_title, product.price, 'displayed');
                        }
                        
                        // Update session summary
                        await updateSessionSummary(sessionId, {
                            products_viewed: formattedProducts.length
                        });
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: true,
                                products: formattedProducts,
                                count: formattedProducts.length,
                                searchCriteria: searchCriteria,
                                note: `Found ${formattedProducts.length} products. Use ONLY the verified_features, actual_materials, and actual_warranties fields.`
                            })
                        });
                        
                        console.log(`✅ Returning ${products.length} products to AI`);
                    } else {
                        // Log failed search for analytics
                        await logEvent(sessionId, 'search_failed', {
                            criteria: searchCriteria,
                            message: 'No available products found'
                        });
                        
                        // Build smart suggestions based on what was searched
                        const suggestions = [];
                        let broadenMessage = "We only show products that are in stock with confirmed prices.";
                        
                        if (searchCriteria.seatCount) {
                            const alternateSizes = searchCriteria.seatCount > 6 
                                ? `${searchCriteria.seatCount - 2} or ${searchCriteria.seatCount + 2} seater`
                                : `${searchCriteria.seatCount + 2} seater`;
                            suggestions.push(`Try a ${alternateSizes} instead`);
                        }
                        if (searchCriteria.material) {
                            const otherMaterials = searchCriteria.material === 'aluminium' 
                                ? 'rattan or teak' 
                                : 'aluminium';
                            suggestions.push(`Consider ${otherMaterials} options which have good availability`);
                        }
                        if (searchCriteria.furnitureType) {
                            suggestions.push(`Show me all available ${searchCriteria.furnitureType} sets`);
                        }
                        suggestions.push("Remove the material filter to see all options");
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: false,
                                message: `No ${searchCriteria.material || ''} ${searchCriteria.furnitureType || 'products'} currently available with ${searchCriteria.seatCount || 'those'} seats. ${broadenMessage}`,
                                reason: "All matching products are either out of stock or awaiting price confirmation",
                                suggestions: suggestions,
                                searchCriteria: searchCriteria,
                                recommendation: "Ask the customer if they'd like to see similar options or different materials"
                            })
                        });
                    }
                }
                
                // STOCK AVAILABILITY HANDLER
                if (toolCall.function.name === "get_product_availability") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const stockStatus = getStockStatus(args.sku);
                    
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({
                            sku: args.sku,
                            in_stock: stockStatus.inStock,
                            stock_level: stockStatus.stockLevel,
                            message: stockStatus.message,
                            low_stock_warning: stockStatus.lowStockWarning
                        })
                    });
                }
                
                // WARRANTY HANDLER
                if (toolCall.function.name === "get_comprehensive_warranty") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const { sku, query_type = 'full_breakdown' } = args;
                    
                    const product = productIndex.bySku[sku];
                    
                    if (!product) {
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: `All MINT Outdoor products come with our comprehensive 1-year structural guarantee.`
                        });
                        continue;
                    }
                    
                    let warrantyBreakdown = `**${product.product_identity.product_name} - Complete Warranty Protection:**\n\n`;
                    warrantyBreakdown += `🛡️ **MINT Outdoor 1-Year Guarantee:**\n`;
                    warrantyBreakdown += `• Structural defects and manufacturing faults\n`;
                    warrantyBreakdown += `• Free replacement parts within first year\n\n`;
                    
                    if (product.materials_and_care && product.materials_and_care.length > 0) {
                        warrantyBreakdown += `🔧 **Individual Material Warranties:**\n\n`;
                        let maxMaterialWarranty = 1;
                        
                        product.materials_and_care.forEach(material => {
                            warrantyBreakdown += `**${material.name}**:\n`;
                            if (material.warranty) {
                                warrantyBreakdown += `• ${material.warranty}\n`;
                                const yearsMatch = material.warranty.match(/(\d+)\s*year/);
                                if (yearsMatch) {
                                    maxMaterialWarranty = Math.max(maxMaterialWarranty, parseInt(yearsMatch[1]));
                                }
                            }
                            if (material.durability_rating) {
                                warrantyBreakdown += `• Durability: ${material.durability_rating}\n`;
                            }
                            warrantyBreakdown += `\n`;
                        });
                        
                        warrantyBreakdown += `✅ **Your Protection Summary:**\n`;
                        warrantyBreakdown += `• Immediate: 1-year full product guarantee\n`;
                        warrantyBreakdown += `• Extended: Up to ${maxMaterialWarranty} years on individual materials\n`;
                    }
                    
                    trackCustomerEducation(session, 'warranty');
                    
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        output: warrantyBreakdown
                    });
                }
                
                // MATERIAL EXPERTISE HANDLER
                if (toolCall.function.name === "get_material_expertise") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const { material, query_type = 'all' } = args;
                    
                    const productsWithMaterial = productKnowledgeCenter.filter(p => {
                        const materialType = p.description_and_category?.material_type?.toLowerCase() || '';
                        const hasMaterial = p.materials_and_care?.some(m =>
                            m.name?.toLowerCase().includes(material.toLowerCase())
                        );
                        return materialType.includes(material.toLowerCase()) || hasMaterial;
                    });
                    
                    if (productsWithMaterial.length === 0) {
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: `${material} is a premium material used in our outdoor furniture. Contact us for detailed information.`
                        });
                        continue;
                    }
                    
                    const materialInfo = new Map();
                    productsWithMaterial.forEach(product => {
                        if (product.materials_and_care) {
                            product.materials_and_care.forEach(mat => {
                                if (mat.name?.toLowerCase().includes(material.toLowerCase())) {
                                    materialInfo.set(mat.name, mat);
                                }
                            });
                        }
                    });
                    
                    let response = `**${material.charAt(0).toUpperCase() + material.slice(1)} Expertise:**\n\n`;
                    materialInfo.forEach((mat, name) => {
                        response += `**${name}**\n`;
                        if (mat.durability_rating) response += `• Durability: ${mat.durability_rating}\n`;
                        if (mat.weather_resistance) response += `• Weather Resistance: ${mat.weather_resistance}\n`;
                        if (mat.warranty) response += `• Warranty: ${mat.warranty}\n\n`;
                        if (mat.pros) response += `**Advantages:**\n${mat.pros}\n\n`;
                        if (mat.cons) response += `**Considerations:**\n${mat.cons}\n\n`;
                        if (mat.maintenance) response += `**Maintenance:**\n${mat.maintenance}\n\n`;
                    });
                    
                    trackCustomerEducation(session, 'materials');
                    
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        output: response
                    });
                }
                
                // DIMENSIONS HANDLER
                if (toolCall.function.name === "get_product_dimensions") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const { sku } = args;
                    
                    const product = productIndex.bySku[sku];
                    
                    if (!product) {
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: `I don't have detailed dimension data for "${sku}" yet. Please contact our team.`
                        });
                        continue;
                    }
                    
                    let response = `**${product.product_identity.product_name} - Dimensions & Details:**\n`;
                    const specs = product.specifications;
                    if (specs) {
                        if (specs.dimensions_cm?.width) {
                            response += `📏 **Dimensions:** ${specs.dimensions_cm.width}cm W × ${specs.dimensions_cm.depth}cm D × ${specs.dimensions_cm.height}cm H\n`;
                        }
                        if (specs.seats) {
                            response += `🪑 **Seating:** ${specs.seats} people\n`;
                        }
                        if (specs.assembly?.required === "Yes") {
                            response += `🔧 **Assembly:** Required (${specs.assembly.difficulty || 'Moderate'} difficulty)\n`;
                        }
                        if (specs.configurable_sides && specs.configurable_sides !== "N/A") {
                            response += `🔄 **Configurable:** ${specs.configurable_sides} orientation\n`;
                        }
                    }
                    
                    trackCustomerEducation(session, 'dimensions');
                    
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        output: response
                    });
                }
                
                // FABRIC EXPERTISE HANDLER
                if (toolCall.function.name === "get_fabric_expertise") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const { fabric_type } = args;
                    
                    const fabricInfo = [];
                    productKnowledgeCenter.forEach(product => {
                        if (product.materials_and_care) {
                            product.materials_and_care.forEach(mat => {
                                if (mat.name?.toLowerCase().includes(fabric_type.toLowerCase())) {
                                    fabricInfo.push(mat);
                                }
                            });
                        }
                    });
                    
                    if (fabricInfo.length > 0) {
                        let response = `**${fabric_type.charAt(0).toUpperCase() + fabric_type.slice(1)} Fabric Information:**\n\n`;
                        const fabric = fabricInfo[0];
                        if (fabric.durability_rating) response += `Durability: ${fabric.durability_rating}\n`;
                        if (fabric.weather_resistance) response += `Weather Resistance: ${fabric.weather_resistance}\n`;
                        if (fabric.warranty) response += `Warranty: ${fabric.warranty}\n\n`;
                        if (fabric.pros) response += `Advantages: ${fabric.pros}\n`;
                        if (fabric.cons) response += `Considerations: ${fabric.cons}\n`;
                        if (fabric.maintenance) response += `Maintenance: ${fabric.maintenance}\n`;
                        
                        trackCustomerEducation(session, 'materials');
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: response
                        });
                    } else {
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: `${fabric_type} is used in our outdoor furniture cushions. Contact us for detailed specifications.`
                        });
                    }
                }
                
                // SEASONAL ADVICE HANDLER
                if (toolCall.function.name === "get_seasonal_advice") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const { season } = args;
                    
                    let response = `**${season.charAt(0).toUpperCase() + season.slice(1)} Recommendations:**\n\n`;
                    
                    if (season === 'spring') {
                        response += `• Perfect time to refresh your outdoor space\n`;
                        response += `• Consider weather-resistant materials like aluminium or treated teak\n`;
                        response += `• Add bright cushions for a fresh spring look\n`;
                    } else if (season === 'summer') {
                        response += `• Peak outdoor season - all products ideal\n`;
                        response += `• Sun loungers and dining sets most popular\n`;
                        response += `• Consider UV-resistant fabrics for longevity\n`;
                    } else if (season === 'autumn') {
                        response += `• Prepare for weather changes with covers\n`;
                        response += `• Teak naturally weathers beautifully\n`;
                        response += `• Storage solutions for cushions recommended\n`;
                    } else if (season === 'winter') {
                        response += `• Protect investments with quality covers\n`;
                        response += `• Aluminium and synthetic rattan handle winter best\n`;
                        response += `• Plan ahead for next season's entertaining\n`;
                    }
                    
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        output: response
                    });
                }
                
                // BUNDLE OFFER HANDLERS
                if (toolCall.function.name === "offer_package_deal") {
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    console.log(`🛠️ Bundle tool called for: ${args.productSku}`);
                    
                    // CHECK IF PRODUCT ACTUALLY HAS BUNDLES DEFINED
                    const accessories = findAccessoriesForProduct(args.productSku);
                    const hasBundles = accessories && accessories.length > 0;
                    
                    if (hasBundles && shouldOfferBundleNaturally(session)) {
                        session.context.offeredPackageDeal = true;
                        session.context.waitingForPackageResponse = true;
                        session.context.packageDealProduct = args.productSku;
                        
                        // Log bundle offer event
                        await logEvent(sessionId, 'bundle_offered', {
                            sku: args.productSku,
                            type: 'package_deal',
                            accessories_count: accessories.length
                        });
                        await updateSessionSummary(sessionId, { bundle_offered: true });
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: true,
                                hasRealBundles: true,
                                accessories: accessories,
                                message: "Offer bundle to customer",
                                offerText: "By the way, we have bundle offers available for this product that could save you money. Would you like to see what bundle deals we have?"
                            })
                        });
                    } else {
                        // No bundles available for this product
                        console.log(`⚠️ No bundles available for SKU: ${args.productSku}`);
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: false,
                                hasRealBundles: false,
                                message: "This product does not have bundle deals available. Focus on product features and the 10% discount instead."
                            })
                        });
                    }
                }
                
                if (toolCall.function.name === "offer_bundle_naturally") {
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    // CHECK IF PRODUCT ACTUALLY HAS BUNDLES DEFINED
                    const accessories = findAccessoriesForProduct(args.mainProductSku);
                    const hasBundles = accessories && accessories.length > 0;
                    
                    if (hasBundles && shouldOfferBundleNaturally(session)) {
                        session.context.offeredBundle = true;
                        session.context.waitingForBundleResponse = true;
                        session.context.bundleProductSku = args.mainProductSku;
                        session.context.bundleCategory = args.productCategory;
                        
                        // Log bundle offer event
                        await logEvent(sessionId, 'bundle_offered', {
                            sku: args.mainProductSku,
                            category: args.productCategory,
                            type: 'natural_offer',
                            accessories_count: accessories.length
                        });
                        await updateSessionSummary(sessionId, { bundle_offered: true });
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: true,
                                message: "Offer bundle naturally to customer",
                                hasRealBundles: true,
                                accessories: accessories,
                                offerText: "By the way, we have bundle offers available for this product that could save you money. Would you like to see what bundle deals we have?"
                            })
                        });
                    } else {
                        // No bundles available for this product - don't offer
                        console.log(`⚠️ No bundles available for SKU: ${args.mainProductSku}`);
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: false,
                                hasRealBundles: false,
                                message: "This product does not have bundle deals available. Focus on product features and the 10% discount instead."
                            })
                        });
                    }
                }
                
                // MARKETING HANDOFF HANDLER
                if (toolCall.function.name === "marketing_handoff") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const emailSent = await sendChatToMarketing(sessionId, args.reason, conversation);
                    
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({
                            success: emailSent,
                            message: emailSent ?
                                "Perfect! I've sent your details to our team. Someone will contact you within a few hours to help with your inquiry." :
                                "I'm having trouble with our email system right now. Please email help@mint-outdoor.com directly."
                        })
                    });
                }
                
                // FAQ HANDLER
                if (toolCall.function.name === "get_faq_answer") {
                    const args = JSON.parse(toolCall.function.arguments);
                    const answer = findFaqAnswer(args.question_keyword);
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        output: answer || "I can't find a specific FAQ for that, but I can provide general advice."
                    });
                }
            }
            
            // Get final response with tool results
            const finalMessages = [
                ...messages,
                aiMessage,
                ...toolResults.map(result => ({
                    role: "tool",
                    tool_call_id: result.tool_call_id,
                    content: result.output
                }))
            ];
            
            const finalResponse = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: finalMessages,
                temperature: 0.4,
                max_tokens: 600
            });
            
            let finalContent = finalResponse.choices[0].message.content;
            
            // Remove emojis
            finalContent = finalContent.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');
            
            return finalContent;
        }
        
        let content = aiMessage.content;
        content = content.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');
        
        return content;
        
    } catch (error) {
        console.error('AI Error:', error);
        return "I apologize, but I'm experiencing a technical issue. Please try again in a moment, or contact our team at support@mint-outdoor.com.";
    }
}

// ============================================
// SECTION 12: HELPER FUNCTIONS
// ============================================

function findOrderById(orderId) {
    return orderData.find(order =>
        order.order_id?.toString() === orderId ||
        order.Order_ID?.toString() === orderId ||
        order.id?.toString() === orderId
    );
}

function verifyCustomer(orderNumber, surname, postcode) {
    const order = findOrderById(orderNumber);
    if (!order) return { verified: false, error: "Order not found" };
    
    const customerSurname = order.surname || order.last_name || order.Surname;
    const customerPostcode = order.postcode || order.postal_code || order.Postcode;
    
    const surnameMatch = customerSurname && customerSurname.toLowerCase().includes(surname.toLowerCase());
    const postcodeMatch = customerPostcode && customerPostcode.toLowerCase().replace(/\s/g, '') === postcode.toLowerCase().replace(/\s/g, '');
    
    if (surnameMatch && postcodeMatch) {
        return { verified: true, order: order };
    }
    
    return { verified: false, error: "Details don't match our records" };
}

function generateSuggestions(message, mode) {
    const lowerMessage = message.toLowerCase();
    
    if (mode === 'sales') {
        if (lowerMessage.includes('teak')) {
            return ["Teak maintenance guide", "Show teak dining sets", "Assembly options"];
        }
        if (lowerMessage.includes('dining')) {
            return ["How many people to seat?", "Assembly service", "Delivery information"];
        }
        if (lowerMessage.includes('lounge')) {
            return ["Material preferences?", "View all lounge sets", "Bundle offers"];
        }
        return ["Dining sets", "Lounge furniture", "Material guide"];
    } else {
        return ["Track my order", "Returns information", "Contact support"];
    }
}

function findFaqAnswer(keyword) {
    const faqs = {
        'delivery': 'We offer free UK delivery. MINT Essentials: 5-10 working days. MINT DesignDrop: 6-10 weeks for pre-order items.',
        'assembly': 'Assembly service is available for £69.95 per product. Most items come with clear instructions for DIY assembly.',
        'warranty': 'All products come with our 1-year structural guarantee, plus extended material-specific warranties up to 10 years.',
        'returns': 'We offer 30-day returns on unused items in original packaging. Contact support for return authorization.',
        'payment': 'We accept all major credit/debit cards, PayPal, and Klarna for payment flexibility.'
    };
    
    for (const [key, answer] of Object.entries(faqs)) {
        if (keyword.toLowerCase().includes(key)) {
            return answer;
        }
    }
    
    return null;
}

function getDeliveryEstimate(stockInfo) {
    if (!stockInfo.inStock) {
        return "Pre-order: 6-10 weeks";
    } else if (stockInfo.stockLevel < 5) {
        return "Limited stock: Order soon for 5-10 working days delivery";
    } else {
        return "In stock: 5-10 working days";
    }
}

function detectProductCategory(customerMessage) {
    const message = customerMessage.toLowerCase();
    
    const categoryMap = {
        'dining': ['dining', 'table', 'chairs', 'eat', 'meal'],
        'lounge': ['lounge', 'sofa', 'relax', 'seating'],
        'corner': ['corner', 'L-shape', 'sectional'],
        'lounger': ['lounger', 'sunbed', 'daybed', 'pool']
    };
    
    for (const [category, keywords] of Object.entries(categoryMap)) {
        if (keywords.some(keyword => message.includes(keyword))) {
            return category;
        }
    }
    
    return null;
}

// ============================================
// SECTION 13: MAIN CHAT ENDPOINT
// ============================================

app.post('/chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        
        if (!message || !sessionId) {
            return res.status(400).json({
                response: 'Please provide a message and session ID.',
                suggestions: ["Hello", "I need help"]
            });
        }
        
        // Initialize or retrieve session
        if (!sessions.has(sessionId)) {
            sessions.set(sessionId, {
                conversationHistory: [],
                context: { startTime: Date.now() },
                qualificationState: {},
                lastActivity: Date.now()
            });
            
            // Log session start event
            await logEvent(sessionId, 'session_started', {
                timestamp: new Date().toISOString(),
                source: 'chat_widget'
            });
            await updateSessionSummary(sessionId, { started_at: new Date() });
        }
        
        const session = sessions.get(sessionId);
        session.lastActivity = Date.now();
        
        // Log user message
        session.conversationHistory.push({
            role: 'user',
            content: message,
            timestamp: new Date()
        });
        
        await logChat(sessionId, 'user', message);
        await logEvent(sessionId, 'user_message', { message_length: message.length });
        await incrementMessageCount(sessionId);
        
        let response;
        let mode = 'sales';
        
        // Check for order inquiry handoff
        if (detectOrderInquiry(message)) {
            const handoffResponse = "I can see you're asking about an existing order. Our order handling team can help you with that. Please visit our ORDER HELPDESK at https://mint-outdoor-support-cf235e896ea9.herokuapp.com/ where you can check your order status, delivery updates, and returns.";
            
            session.conversationHistory.push({
                role: 'assistant',
                content: handoffResponse,
                timestamp: new Date()
            });
            
            await logChat(sessionId, 'assistant', handoffResponse);
            await logEvent(sessionId, 'order_handoff', { reason: 'order_inquiry_detected' });
            
            return res.json({
                response: handoffResponse,
                sessionId: sessionId,
                handoff: 'order_desk',
                handoffUrl: 'https://mint-outdoor-support-cf235e896ea9.herokuapp.com/'
            });
        }
        
        // Check for order number in message
        const orderMatch = message.match(/\b\d{6,}\b/);
        
        if (orderMatch) {
            mode = 'order';
            session.context.mode = 'order';
            
            const orderNumber = orderMatch[0];
            const verificationMatch = message.match(/(\w+)\s+([A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2})/i);
            
            if (verificationMatch) {
                const surname = verificationMatch[1];
                const postcode = verificationMatch[2];
                
                const verification = verifyCustomer(orderNumber, surname, postcode);
                
                if (verification.verified) {
                    const order = verification.order;
                    response = `Order ${orderNumber} verified successfully!\n\nOrder Details:\n• Status: ${order.status || 'Processing'}\n• Delivery: ${order.delivery_date || 'Within 5-10 working days'}\n\nFor detailed tracking, please visit our Order Desk.`;
                } else {
                    response = `I couldn't verify order ${orderNumber} with those details. Please double-check your surname and postcode, or contact us at support@mint-outdoor.com for assistance.`;
                }
            } else {
                response = `Please provide both your surname and postcode separated by a space.`;
            }
        } else {
            // Check for promo code inquiries
            const promoKeywords = ['promo code', 'discount code', 'voucher code', 'coupon code'];
            const isPromoQuery = promoKeywords.some(keyword => message.toLowerCase().includes(keyword));
            
            if (isPromoQuery) {
                response = "Sorry, I am not able to check on promo codes so you would need to refer back to the publication you found the promo code. Sometimes they are time sensitive and othertimes they are not real promo codes issued by us but other companies attempting to get you to visit their website.";
                
                session.conversationHistory.push({ role: 'assistant', content: response, timestamp: new Date() });
                await logChat(sessionId, 'assistant', response);
                
                return res.json({
                    response: response,
                    sessionId: sessionId,
                    suggestions: ["Continue shopping", "Product recommendations"]
                });
            }
            
            // Sales mode
            mode = 'sales';
            session.context.mode = 'sales';
            
            const lowerMessage = message.toLowerCase();
            const discountKeywords = ['discount', 'cheaper', 'expensive', 'too much', 'price high', 'reduce price', 'lower price'];
            const isDiscountRequest = discountKeywords.some(keyword => lowerMessage.includes(keyword));
            
            // Detect email for discount
            const emailMatch = message.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
            
            if (session.context.waitingForDiscountEmail && emailMatch) {
                const customerEmail = emailMatch[0];
                const discountType = session.context.discountType || '10%';
                const productDetails = session.context.discountProduct || 'Selected product';
                
                const reason = discountType === '20%' ?
                    `20% Bundle Discount Request - Customer Email: ${customerEmail} - Product: ${productDetails}` :
                    `10% Discount Request - Customer Email: ${customerEmail} - Product: ${productDetails}`;
                
                const emailSent = await sendChatToMarketing(
                    sessionId,
                    reason,
                    session.conversationHistory,
                    { email: customerEmail }
                );
                
                // Log email capture event
                await logEvent(sessionId, 'email_captured', {
                    email: customerEmail,
                    discount_type: discountType
                });
                await updateSessionSummary(sessionId, {
                    email_captured: true,
                    email_address: customerEmail
                });
                
                if (emailSent) {
                    response = `Perfect! I've sent your request to our manager Rachel.\n\n📧 Your email: ${customerEmail}\n💰 Discount: ${discountType} off\n\nYou'll receive a secure payment link within the next 2 hours with your discount applied. Check your inbox (and spam folder just in case)!\n\nAnything else I can help you with while we process this?`;
                } else {
                    response = `I've noted your email (${customerEmail}) but I'm having a technical issue sending it through. Please email rachel@mint-outdoor.com directly with:\n\n- Subject: "${discountType} Discount Request from Gwen"\n- Your session ID: ${sessionId}\n- Product you're interested in\n\nRachel will sort you out within 2 hours!`;
                }
                
                session.context.waitingForDiscountEmail = false;
                delete session.context.discountType;
                delete session.context.discountProduct;
                
                session.conversationHistory.push({ role: 'assistant', content: response, timestamp: new Date() });
                await logChat(sessionId, 'assistant', response);
                
                return res.json({
                    response: response,
                    sessionId: sessionId,
                    suggestions: ["Continue shopping", "Tell me more"]
                });
            }
            
            // Mark discount interest
            if (isDiscountRequest && !session.context.discountOffered) {
                session.context.discountInterest = true;
                console.log(`💰 Discount interest detected`);
            }
            
            // Handle bundle responses
            if (session.context.waitingForPackageResponse) {
                console.log(`🎁 Bundle response handler triggered. Message: "${message}"`);
                
                if (lowerMessage.includes('yes') || lowerMessage.includes('sure') ||
                    lowerMessage.includes('show') || lowerMessage.includes('see') ||
                    lowerMessage.includes('please') || lowerMessage.includes('ok')) {
                    
                    console.log(`🎯 Customer agreed! Finding bundles for: ${session.context.packageDealProduct}`);
                    
                    session.context.waitingForPackageResponse = false;
                    const productSku = session.context.packageDealProduct;
                    
                    // Log bundle acceptance
                    await logEvent(sessionId, 'bundle_accepted', {
                        sku: productSku
                    });
                    await updateSessionSummary(sessionId, { bundle_accepted: true });
                    
                    try {
                        const bundles = await findBundleRecommendations(productSku);
                        
                        if (bundles && bundles.length > 0) {
                            response = "Excellent! Here are the perfect additions to complete your outdoor setup:\n\n";
                            bundles.forEach(item => {
                                response += `**${item.product_title}**\n`;
                                response += `Price: ${item.price}\n`;
                                response += `${item.bundle_description || ''}\n\n`;
                            });
                            response += "Would you like to add any of these to your order? I can send your complete bundle request to our team.";
                        } else {
                            response = "Let me help you create the perfect bundle for your needs. I'll send your requirements to our team who can create a custom package deal for you.";
                            delete session.context.packageDealProduct;
                        }
                    } catch (error) {
                        console.error('Bundle error:', error);
                        response = "I'll get our team to prepare some bundle options for you. They'll be in touch shortly with great package deals!";
                        delete session.context.packageDealProduct;
                    }
                    
                } else if (lowerMessage.includes('no') || lowerMessage.includes('not interested')) {
                    session.context.waitingForPackageResponse = false;
                    session.context.offeredBundle = true;
                    delete session.context.packageDealProduct;
                    
                    // Log bundle rejection
                    await logEvent(sessionId, 'bundle_rejected', {});
                    
                    response = "No problem! How else can I help you?";
                } else {
                    response = "Would you like to see our bundle offers for this product? They can save you money and complete your outdoor setup.";
                }
                
                session.conversationHistory.push({ role: 'assistant', content: response, timestamp: new Date() });
                await logChat(sessionId, 'assistant', response);
                
                return res.json({
                    response: response,
                    sessionId: sessionId,
                    suggestions: ["Continue", "Tell me more"]
                });
            }
            
            // Handle refund claim flow
            if (session.context.waitingForRefundClaim) {
                const customerDetails = extractCustomerDetails(message);
                
                if (customerDetails.hasRequiredInfo) {
                    session.context.waitingForRefundClaim = false;
                    
                    const emailSent = await sendChatToMarketing(
                        sessionId,
                        'Bundle Purchase with £30 Refund Claim',
                        session.conversationHistory,
                        customerDetails
                    );
                    
                    if (emailSent) {
                        response = `Excellent! I have your details:\n📧 Email: ${customerDetails.email}\n📍 Postcode: ${customerDetails.postcode}\n\nPlease place your bundle order using the email and postcode you gave me and I will arrange the £30 refund within 48 hours.\n\nThank you for choosing MINT Outdoor!`;
                    } else {
                        response = `I have your details, but I'm having trouble with our system. Please email marketing@mint-outdoor.com with:\n\n- Subject: "Bundle Order + £30 Refund"\n- Your email: ${customerDetails.email}\n- Your postcode: ${customerDetails.postcode}\n- Session ID: ${sessionId}\n\nOur team will process this quickly!`;
                    }
                } else {
                    const missing = [];
                    if (!customerDetails.email) missing.push('email address');
                    if (!customerDetails.postcode) missing.push('postcode');
                    
                    response = `I need your ${missing.join(' and ')} to process the £30 refund. Please provide both in your next message.\n\nExample: "john@email.com SW1A 1AA"`;
                }
                
                session.conversationHistory.push({ role: 'assistant', content: response, timestamp: new Date() });
                await logChat(sessionId, 'assistant', response);
                
                return res.json({
                    response: response,
                    sessionId: sessionId,
                    suggestions: ["Continue", "Tell me more"]
                });
            }
            
            // Generate AI response
            response = await generateAISalesResponse(message, sessionId, session);
        }
        
        // Log assistant response
        session.conversationHistory.push({
            role: 'assistant',
            content: response,
            timestamp: new Date()
        });
        
        await logChat(sessionId, 'assistant', response);
        
        // Update interest score
        const finalInterestScore = calculateCustomerInterestScore(session);
        await updateSessionSummary(sessionId, { final_interest_score: finalInterestScore });
        
        const suggestions = generateSuggestions(message, mode);
        
        res.json({
            response: response,
            sessionId: sessionId,
            suggestions: suggestions,
            mode: mode
        });
        
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({
            response: "I apologize, but I'm experiencing a technical issue. Please try again in a moment.",
            suggestions: ["Try again", "Contact support"]
        });
    }
});

// ============================================
// SECTION 14: ANALYTICS API ENDPOINTS
// ============================================

// KPI Summary Endpoint
app.get('/analytics/kpi-summary', async (req, res) => {
    if (!pool) {
        return res.json({ error: 'Database not connected', data: null });
    }
    
    const days = parseInt(req.query.days) || 7;
    
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(DISTINCT session_id) as total_sessions,
                COUNT(DISTINCT CASE WHEN message_count >= 3 THEN session_id END) as engaged_sessions,
                COUNT(DISTINCT CASE WHEN products_viewed > 0 THEN session_id END) as product_sessions,
                COUNT(DISTINCT CASE WHEN bundle_offered = true THEN session_id END) as bundle_offered_count,
                COUNT(DISTINCT CASE WHEN bundle_accepted = true THEN session_id END) as bundle_accepted_count,
                COUNT(DISTINCT CASE WHEN email_captured = true THEN session_id END) as email_captured_count,
                COUNT(DISTINCT CASE WHEN handoff_triggered = true THEN session_id END) as handoff_count,
                AVG(message_count) as avg_messages_per_session,
                AVG(final_interest_score) as avg_interest_score
            FROM session_summary 
            WHERE started_at >= NOW() - INTERVAL '${days} days'
        `);
        
        const row = result.rows[0];
        const totalSessions = parseInt(row.total_sessions) || 1;
        
        res.json({
            period_days: days,
            total_sessions: parseInt(row.total_sessions) || 0,
            engaged_rate: ((parseInt(row.engaged_sessions) || 0) / totalSessions * 100).toFixed(1),
            product_display_rate: ((parseInt(row.product_sessions) || 0) / totalSessions * 100).toFixed(1),
            bundle_offer_rate: ((parseInt(row.bundle_offered_count) || 0) / totalSessions * 100).toFixed(1),
            bundle_acceptance_rate: ((parseInt(row.bundle_accepted_count) || 0) / (parseInt(row.bundle_offered_count) || 1) * 100).toFixed(1),
            email_capture_rate: ((parseInt(row.email_captured_count) || 0) / totalSessions * 100).toFixed(1),
            handoff_rate: ((parseInt(row.handoff_count) || 0) / totalSessions * 100).toFixed(1),
            avg_messages_per_session: parseFloat(row.avg_messages_per_session || 0).toFixed(1),
            avg_interest_score: parseFloat(row.avg_interest_score || 0).toFixed(1)
        });
    } catch (error) {
        console.error('KPI Summary Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Top Products Endpoint
app.get('/analytics/top-products', async (req, res) => {
    if (!pool) {
        return res.json({ error: 'Database not connected', data: null });
    }
    
    const days = parseInt(req.query.days) || 7;
    
    try {
        const result = await pool.query(`
            SELECT 
                sku,
                product_name,
                COUNT(*) as display_count,
                COUNT(DISTINCT session_id) as unique_sessions
            FROM product_interactions 
            WHERE created_at >= NOW() - INTERVAL '${days} days'
            GROUP BY sku, product_name
            ORDER BY display_count DESC
            LIMIT 10
        `);
        
        res.json({
            period_days: days,
            products: result.rows
        });
    } catch (error) {
        console.error('Top Products Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// QUALITY ANALYSIS ENDPOINT - Kaizen Recommendations
app.get('/analytics/quality-analysis', async (req, res) => {
    if (!pool) {
        return res.json({ 
            error: 'Database not connected',
            quality_score: 0,
            issues_summary: { critical: 0, warnings: 0 },
            recommendations: []
        });
    }
    
    try {
        // Get recent assistant messages for analysis
        const messagesResult = await pool.query(`
            SELECT session_id, message, timestamp 
            FROM chat_logs 
            WHERE role = 'assistant' 
            AND timestamp >= NOW() - INTERVAL '7 days'
            ORDER BY timestamp DESC
            LIMIT 100
        `);
        
        const messages = messagesResult.rows;
        
        // Initialize issue counters
        const issues = {
            missing_price: [],
            placeholder_text: [],
            missing_bundle_calc: [],
            no_image: [],
            too_short: [],
            no_cta: []
        };
        
        // Analyze each message
        messages.forEach(msg => {
            const content = msg.message || '';
            const sessionId = msg.session_id;
            const timestamp = msg.timestamp;
            
            // Check for missing prices
            if (content.includes('Contact for pricing') || 
                content.includes('Check price') ||
                content.includes('Price: Contact')) {
                issues.missing_price.push({ sessionId, timestamp, detail: 'Price showing as "Contact for pricing"' });
            }
            
            // Check for placeholder text that wasn't replaced
            if (content.includes('[savings]') || 
                content.includes('[price]') ||
                content.includes('[total]') ||
                content.includes('£[') ||
                content.includes('= Total') ||
                content.includes('= Discounted Total')) {
                issues.placeholder_text.push({ sessionId, timestamp, detail: 'Unreplaced placeholder like £[savings]' });
            }
            
            // Check for incomplete bundle calculations
            if (content.includes('20% OFF') && 
                (content.includes('Check price') || !content.match(/YOU SAVE £\d/))) {
                issues.missing_bundle_calc.push({ sessionId, timestamp, detail: 'Bundle offer without calculated savings' });
            }
            
            // Check for responses that should have images but don't mention them
            if ((content.includes('Set') || content.includes('Sofa') || content.includes('Corner')) &&
                content.includes('Price:') &&
                !content.includes('View in Store')) {
                issues.no_cta.push({ sessionId, timestamp, detail: 'Product missing View in Store link' });
            }
            
            // Check for very short responses (might indicate errors)
            if (content.length < 100 && content.includes('product')) {
                issues.too_short.push({ sessionId, timestamp, detail: 'Response too short for product display' });
            }
        });
        
        // Calculate quality score
        const totalMessages = messages.length || 1;
        const totalIssues = Object.values(issues).reduce((sum, arr) => sum + arr.length, 0);
        const qualityScore = Math.max(0, Math.round(100 - (totalIssues / totalMessages * 100)));
        
        // Count critical vs warnings
        const criticalCount = issues.missing_price.length + issues.placeholder_text.length + issues.missing_bundle_calc.length;
        const warningCount = issues.no_image.length + issues.too_short.length + issues.no_cta.length;
        
        // Build recommendations
        const recommendations = [];
        
        if (issues.missing_price.length > 0) {
            recommendations.push({
                severity: 'critical',
                title: 'Missing Product Prices',
                count: issues.missing_price.length,
                description: 'Products are showing "Contact for pricing" instead of actual prices. This kills conversion.',
                action: 'Check Shopify API authentication. The logs show "401 Unauthorized" errors. Go to Heroku > Settings > Config Vars and verify SHOPIFY_ACCESS_TOKEN is correct. Generate a new token from Shopify Admin > Apps > Develop apps if needed.'
            });
        }
        
        if (issues.placeholder_text.length > 0) {
            recommendations.push({
                severity: 'critical',
                title: 'Unreplaced Placeholder Text',
                count: issues.placeholder_text.length,
                description: 'Bundle savings showing as "£[savings]" or "= Total" instead of actual calculated amounts.',
                action: 'This is caused by missing prices from Shopify. Fix the SHOPIFY_ACCESS_TOKEN first (see above), then bundle calculations will work automatically.'
            });
        }
        
        if (issues.missing_bundle_calc.length > 0) {
            recommendations.push({
                severity: 'warning',
                title: 'Incomplete Bundle Calculations',
                count: issues.missing_bundle_calc.length,
                description: 'Bundle offers are being shown without the "YOU SAVE £X" calculation that drives conversions.',
                action: 'Ensure accessory prices are available. Check bundle_items.json has correct SKUs that match Shopify inventory.'
            });
        }
        
        if (issues.no_cta.length > 0) {
            recommendations.push({
                severity: 'info',
                title: 'Missing Call-to-Action',
                count: issues.no_cta.length,
                description: 'Some product displays are missing a clear next step for the customer.',
                action: 'The AI prompt should always include "View in Store" link and "What do you think?" after showing products.'
            });
        }
        
        // Get recent issues for the table
        const recentIssues = [];
        Object.entries(issues).forEach(([type, issueList]) => {
            issueList.slice(0, 5).forEach(issue => {
                recentIssues.push({
                    type: type.replace(/_/g, ' '),
                    session_id: issue.sessionId,
                    timestamp: issue.timestamp,
                    detail: issue.detail,
                    severity: ['missing_price', 'placeholder_text', 'missing_bundle_calc'].includes(type) ? 'critical' : 'warning'
                });
            });
        });
        
        // Sort by timestamp
        recentIssues.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        console.log('📊 Quality Analysis Complete:', {
            score: qualityScore,
            critical: criticalCount,
            warnings: warningCount,
            messagesAnalyzed: totalMessages
        });
        
        res.json({
            quality_score: qualityScore,
            issues_summary: {
                critical: criticalCount,
                warnings: warningCount
            },
            recommendations: recommendations,
            recent_issues: recentIssues.slice(0, 15),
            analyzed_messages: totalMessages
        });
        
    } catch (error) {
        console.error('Quality Analysis Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// INVENTORY HEALTH ENDPOINT - Check which products are sellable
app.get('/analytics/inventory-health', async (req, res) => {
    try {
        console.log('📦 Running inventory health check...');
        
        const healthReport = {
            timestamp: new Date().toISOString(),
            total_products: productKnowledgeCenter?.length || 0,
            sellable: [],
            unsellable: {
                no_price: [],
                out_of_stock: [],
                missing_sku: []
            },
            summary: {}
        };
        
        if (!productKnowledgeCenter || productKnowledgeCenter.length === 0) {
            return res.json({
                error: 'No product data loaded',
                healthReport
            });
        }
        
        // Check each product
        for (const product of productKnowledgeCenter) {
            const sku = product.product_identity?.sku;
            const name = product.product_identity?.product_name || 'Unknown';
            const localPrice = product.product_identity?.price;
            
            if (!sku) {
                healthReport.unsellable.missing_sku.push({ name, reason: 'No SKU defined' });
                continue;
            }
            
            // Get Shopify data for this product
            let shopifyData = null;
            try {
                shopifyData = await getShopifyProductBySku(sku);
            } catch (e) {
                // Ignore errors
            }
            
            // Determine price
            const price = shopifyData?.price 
                ? `£${parseFloat(shopifyData.price).toFixed(2)}`
                : localPrice;
            
            // Determine stock
            const stockLevel = shopifyData?.inventory_quantity ?? 
                parseInt(product.logistics_and_inventory?.inventory?.available) ?? null;
            const inStock = stockLevel === null || stockLevel > 0;
            
            // Check if sellable
            const hasValidPrice = price && 
                price !== 'Contact for pricing' && 
                !price.includes('Contact');
            
            if (!hasValidPrice) {
                healthReport.unsellable.no_price.push({
                    sku,
                    name,
                    local_price: localPrice || 'None',
                    shopify_price: shopifyData?.price || 'Not found',
                    reason: 'No valid price'
                });
            } else if (!inStock) {
                healthReport.unsellable.out_of_stock.push({
                    sku,
                    name,
                    price,
                    stock_level: stockLevel,
                    reason: 'Out of stock'
                });
            } else {
                healthReport.sellable.push({
                    sku,
                    name,
                    price,
                    stock_level: stockLevel || 'Unknown'
                });
            }
        }
        
        // Calculate summary
        healthReport.summary = {
            sellable_count: healthReport.sellable.length,
            no_price_count: healthReport.unsellable.no_price.length,
            out_of_stock_count: healthReport.unsellable.out_of_stock.length,
            missing_sku_count: healthReport.unsellable.missing_sku.length,
            sellable_percentage: Math.round((healthReport.sellable.length / healthReport.total_products) * 100)
        };
        
        console.log('📊 Inventory Health Summary:', healthReport.summary);
        
        res.json(healthReport);
        
    } catch (error) {
        console.error('Inventory Health Check Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Enhanced Session Detail Endpoint with Quality Issues
app.get('/analytics/session/:sessionId', async (req, res) => {
    if (!pool) {
        return res.json({ error: 'Database not connected', data: null });
    }
    
    const { sessionId } = req.params;
    
    try {
        const summaryResult = await pool.query(
            'SELECT * FROM session_summary WHERE session_id = $1',
            [sessionId]
        );
        
        const eventsResult = await pool.query(
            'SELECT * FROM chat_events WHERE session_id = $1 ORDER BY created_at',
            [sessionId]
        );
        
        const messagesResult = await pool.query(
            'SELECT * FROM chat_logs WHERE session_id = $1 ORDER BY timestamp',
            [sessionId]
        );
        
        // Analyze this session for quality issues
        const qualityIssues = [];
        messagesResult.rows.forEach(msg => {
            if (msg.role === 'assistant') {
                const content = msg.message || '';
                
                if (content.includes('Contact for pricing')) {
                    qualityIssues.push('❌ CRITICAL: Missing price - showing "Contact for pricing" instead of actual £ amount. Fix: Check SHOPIFY_ACCESS_TOKEN in Heroku config.');
                }
                if (content.includes('[savings]') || content.includes('= Total') || content.includes('= Discounted Total')) {
                    qualityIssues.push('❌ CRITICAL: Placeholder text not replaced - bundle calculation failed because prices are missing.');
                }
                if (content.includes('Check price')) {
                    qualityIssues.push('❌ CRITICAL: Accessory price not loaded - "Check price" shown instead of £ amount.');
                }
                if (content.includes('20% OFF') && !content.match(/YOU SAVE £\d/)) {
                    qualityIssues.push('⚠️ WARNING: Bundle discount mentioned but savings not calculated - will not convert.');
                }
            }
        });
        
        res.json({
            summary: summaryResult.rows[0] || null,
            events: eventsResult.rows,
            messages: messagesResult.rows,
            quality_issues: [...new Set(qualityIssues)] // Remove duplicates
        });
    } catch (error) {
        console.error('Session Detail Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Daily Trends Endpoint
app.get('/analytics/daily-trends', async (req, res) => {
    if (!pool) {
        return res.json({ error: 'Database not connected', data: null });
    }
    
    const days = parseInt(req.query.days) || 30;
    
    try {
        const result = await pool.query(`
            SELECT 
                DATE(started_at) as date,
                COUNT(*) as sessions,
                COUNT(CASE WHEN message_count >= 3 THEN 1 END) as engaged,
                COUNT(CASE WHEN products_viewed > 0 THEN 1 END) as with_products,
                COUNT(CASE WHEN bundle_offered = true THEN 1 END) as bundles_offered,
                COUNT(CASE WHEN email_captured = true THEN 1 END) as emails_captured
            FROM session_summary 
            WHERE started_at >= NOW() - INTERVAL '${days} days'
            GROUP BY DATE(started_at)
            ORDER BY DATE(started_at)
        `);
        
        res.json({
            period_days: days,
            trends: result.rows
        });
    } catch (error) {
        console.error('Daily Trends Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Failed Searches Endpoint
app.get('/analytics/failed-searches', async (req, res) => {
    if (!pool) {
        return res.json({ error: 'Database not connected', data: null });
    }
    
    const days = parseInt(req.query.days) || 7;
    
    try {
        const result = await pool.query(`
            SELECT 
                event_data,
                COUNT(*) as count,
                created_at
            FROM chat_events 
            WHERE event_type = 'search_failed'
            AND created_at >= NOW() - INTERVAL '${days} days'
            GROUP BY event_data, created_at
            ORDER BY count DESC
            LIMIT 20
        `);
        
        res.json({
            period_days: days,
            failed_searches: result.rows
        });
    } catch (error) {
        console.error('Failed Searches Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Recent Sessions Endpoint
app.get('/analytics/recent-sessions', async (req, res) => {
    if (!pool) {
        return res.json({ error: 'Database not connected', data: null });
    }
    
    const limit = parseInt(req.query.limit) || 20;
    
    try {
        const result = await pool.query(`
            SELECT 
                session_id,
                started_at,
                message_count,
                products_viewed,
                bundle_offered,
                bundle_accepted,
                email_captured,
                handoff_triggered,
                persona_detected,
                final_interest_score
            FROM session_summary 
            ORDER BY started_at DESC
            LIMIT $1
        `, [limit]);
        
        res.json({
            sessions: result.rows
        });
    } catch (error) {
        console.error('Recent Sessions Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// SECTION 15: HEALTH & DEBUG ENDPOINTS
// ============================================

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '12.0.0-with-analytics',
        features: {
            ENABLE_SALES_MODE: ENABLE_SALES_MODE,
            unified_data: true,
            analytics_enabled: !!pool,
            products_indexed: Object.keys(productIndex.bySku).length
        },
        data: {
            products_loaded: Object.keys(productIndex.bySku).length,
            orders_loaded: Array.isArray(orderData) ? orderData.length : 0,
            inventory_records_loaded: Array.isArray(inventoryData) ? inventoryData.length : 0,
            bundles_loaded: Array.isArray(bundleSuggestions) ? bundleSuggestions.length : 0,
            bundle_items_loaded: Array.isArray(bundleItems) ? bundleItems.length : 0,
            knowledge_base: {
                categories: Object.keys(productIndex.byCategory).length,
                materials: Object.keys(productIndex.byMaterial).length,
                seat_configs: Object.keys(productIndex.bySeats).length,
                taxonomy_types: Object.keys(productIndex.byTaxonomy).length
            },
            ai_tools_available: aiTools.length
        }
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

app.get('/widget', (req, res) => {
    res.sendFile(path.join(__dirname, 'widget.html'));
});

app.get('/analytics', (req, res) => {
    res.sendFile(path.join(__dirname, 'analytics.html'));
});

app.get('/test-bundles', (req, res) => {
    res.json({
        bundle_suggestions_loaded: bundleSuggestions ? bundleSuggestions.length : 0,
        bundle_items_loaded: bundleItems ? bundleItems.length : 0,
        sample_bundle: bundleSuggestions ? bundleSuggestions[0] : null,
        sample_items: bundleItems ? bundleItems.slice(0, 3) : null
    });
});

app.get('/debug-products', (req, res) => {
    const products = Object.values(productIndex.bySku).slice(0, 20).map(p => ({
        sku: p.product_identity?.sku,
        title: p.product_identity?.product_name,
        category: p.description_and_category?.primary_category,
        material: p.description_and_category?.material_type
    }));
    
    res.json({
        total_products: Object.keys(productIndex.bySku).length,
        sample_products: products,
        note: "Data from unified product_knowledge_center.json"
    });
});

app.get('/test-unified-data', (req, res) => {
    const tests = {
        total_products: productKnowledgeCenter.length,
        valid_products: productKnowledgeCenter.filter(p =>
            p.product_identity?.sku &&
            p.description_and_category?.primary_category
        ).length,
        products_with_materials: productKnowledgeCenter.filter(p =>
            p.materials_and_care && p.materials_and_care.length > 0
        ).length,
        products_with_dimensions: productKnowledgeCenter.filter(p =>
            p.specifications?.dimensions_cm?.width
        ).length,
        categories: [...new Set(productKnowledgeCenter.map(p =>
            p.description_and_category?.primary_category
        ).filter(Boolean))],
        material_types: [...new Set(productKnowledgeCenter.map(p =>
            p.description_and_category?.material_type
        ).filter(Boolean))]
    };
    
    res.json(tests);
});

// ============================================
// SECTION 16: SESSION CLEANUP & SERVER STARTUP
// ============================================

// Session cleanup every hour
setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    let cleaned = 0;
    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.lastActivity > oneHour) {
            // Log session end before cleaning
            logEvent(sessionId, 'session_ended', {
                duration_minutes: Math.round((now - (session.context.startTime || now)) / 60000),
                message_count: session.conversationHistory.length
            });
            updateSessionSummary(sessionId, { ended_at: new Date() });
            
            sessions.delete(sessionId);
            cleaned++;
        }
    }
    if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} expired sessions`);
}, 60 * 60 * 1000);

// ============================================
// SERVER STARTUP
// ============================================

const port = process.env.PORT || 3000;

// Initialize analytics tables then start server
initializeAnalyticsTables().then(() => {
    app.listen(port, () => {
        console.log(`\n🚀 MINT Outdoor AI System v12.0 (With Analytics) running on port ${port}`);
        console.log(`📊 Sales Mode: ${ENABLE_SALES_MODE ? 'ENABLED' : 'DISABLED'}`);
        console.log(`📦 Products indexed: ${Object.keys(productIndex.bySku).length}`);
        console.log(`📋 Orders loaded: ${Array.isArray(orderData) ? orderData.length : 'N/A'}`);
        console.log(`📊 Inventory records: ${Array.isArray(inventoryData) ? inventoryData.length : 'N/A'}`);
        console.log(`🎁 Bundle suggestions: ${Array.isArray(bundleSuggestions) ? bundleSuggestions.length : 'N/A'}`);
        console.log(`🔗 Bundle items: ${Array.isArray(bundleItems) ? bundleItems.length : 'N/A'}`);
        console.log('\n🔧 ENVIRONMENT CHECK:');
        console.log(`   📧 Email User: ${process.env.EMAIL_USER ? '✅ Set' : '❌ Missing'}`);
        console.log(`   🔑 Email Password: ${process.env.EMAIL_PASSWORD ? '✅ Set' : '❌ Missing'}`);
        console.log(`   🤖 OpenAI Key: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
        console.log(`   🛒 Shopify Token: ${SHOPIFY_ACCESS_TOKEN ? '✅ Set' : '⚠️ Not configured'}`);
        console.log(`   🗄️ Database: ${pool ? '✅ Connected' : '⚠️ Not configured'}`);
        
        console.log('\n✨ VERSION 12.0 FEATURES:');
        console.log('   ✅ All original sales functionality preserved');
        console.log('   ✅ Unified product_knowledge_center.json');
        console.log('   ✅ High-performance indexes');
        console.log('   ✅ Bundle system with 20% discount');
        console.log('   ✅ Email handoff to Rachel');
        console.log('   ✅ Persona detection');
        console.log('   ✅ Stock urgency messaging');
        console.log('   ✅ NEW: Analytics event logging');
        console.log('   ✅ NEW: Session summary tracking');
        console.log('   ✅ NEW: Product interaction logging');
        console.log('   ✅ NEW: KPI API endpoints');
        console.log('   ✅ NEW: Analytics dashboard endpoint');
        
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            console.warn('\n⚠️  WARNING: Email system not configured - handoffs will fail!');
        }
        
        if (!SHOPIFY_ACCESS_TOKEN) {
            console.warn('\n⚠️  WARNING: Shopify not configured - prices will not be live!');
        }
        
        if (!pool) {
            console.warn('\n⚠️  WARNING: Database not configured - analytics will be limited!');
        }
        
        console.log('\n📊 ANALYTICS ENDPOINTS:');
        console.log('   GET /analytics/kpi-summary?days=7');
        console.log('   GET /analytics/top-products?days=7');
        console.log('   GET /analytics/session/:sessionId');
        console.log('   GET /analytics/daily-trends?days=30');
        console.log('   GET /analytics/failed-searches?days=7');
        console.log('   GET /analytics/recent-sessions?limit=20');
        console.log('   GET /analytics (Dashboard HTML)');
    });
});

module.exports = app;