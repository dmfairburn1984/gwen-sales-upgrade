// services/conversationService.js - Intent analysis and conversation logging
const { Pool } = require('pg');

// Database connection (same as your existing system)
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// Intent analysis function
async function analyzeIntent(message, session) {
    const lowerMessage = message.toLowerCase();
    
    // Order-related keywords (high priority)
    const orderKeywords = [
        'order', 'delivery', 'tracking', 'shipped', 'refund', 'return',
        'where is my', 'when will', 'cancel', 'change order', 
        'order number', 'receipt', 'invoice', 'warranty',
        'damaged', 'faulty', 'replacement', 'late', 'delayed'
    ];
    
    // Sales-related keywords
    const salesKeywords = [
        'buy', 'purchase', 'looking for', 'need', 'want',
        'dining set', 'table', 'chair', 'sofa', 'furniture',
        'garden', 'patio', 'outdoor', 'balcony',
        'price', 'cost', 'how much', 'budget',
        'recommendation', 'suggest', 'best', 'show me'
    ];
    
    // Check for order intent first (higher priority)
    const orderScore = orderKeywords.reduce((score, keyword) => {
        return lowerMessage.includes(keyword) ? score + 1 : score;
    }, 0);
    
    // Check for sales intent
    const salesScore = salesKeywords.reduce((score, keyword) => {
        return lowerMessage.includes(keyword) ? score + 1 : score;
    }, 0);
    
    // Check if there's an order number in the message
    const hasOrderNumber = /\b\d{6,}\b/.test(message);
    
    // Check session context
    const hasOrderContext = session.context?.orderId || session.context?.awaitingVerification;
    
    // Decision logic
    if (hasOrderNumber || hasOrderContext || orderScore > 0) {
        return {
            type: 'order',
            confidence: orderScore + (hasOrderNumber ? 2 : 0) + (hasOrderContext ? 1 : 0),
            keywords_matched: orderKeywords.filter(k => lowerMessage.includes(k))
        };
    } else if (salesScore > 0) {
        return {
            type: 'sales',
            confidence: salesScore,
            keywords_matched: salesKeywords.filter(k => lowerMessage.includes(k))
        };
    } else {
        // Default to sales for ambiguous messages
        return {
            type: 'sales',
            confidence: 0,
            keywords_matched: []
        };
    }
}

// Enhanced logging function
async function logConversation(sessionId, userMessage, aiResponse, handler) {
    if (!pool) {
        console.log('Database not available, skipping log');
        return;
    }
    
    try {
        // Ensure the enhanced table exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS enhanced_chat_logs (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                user_message TEXT,
                ai_response TEXT,
                handler VARCHAR(50),
                intent_keywords TEXT[],
                escalated BOOLEAN DEFAULT FALSE
            )
        `);
        
        // Check for escalation keywords in user message
        const escalationKeywords = [
            'manager', 'supervisor', 'complaint', 'refund', 'compensation',
            'terrible', 'awful', 'disgraceful', 'angry', 'furious',
            'cancel', 'unacceptable', 'wedding', 'event', 'party'
        ];
        
        const lowerUserMessage = userMessage.toLowerCase();
        const isEscalated = escalationKeywords.some(keyword => 
            lowerUserMessage.includes(keyword)
        );
        
        const matchedKeywords = escalationKeywords.filter(keyword =>
            lowerUserMessage.includes(keyword)
        );
        
        // Insert the conversation log
        await pool.query(`
            INSERT INTO enhanced_chat_logs 
            (session_id, user_message, ai_response, handler, intent_keywords, escalated)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            sessionId,
            userMessage,
            aiResponse,
            handler,
            matchedKeywords,
            isEscalated
        ]);
        
        console.log(`✅ Logged conversation: ${handler} handler, escalated: ${isEscalated}`);
        
    } catch (error) {
        console.error('Logging error:', error.message);
        // Don't let logging errors break the conversation
    }
}

// Analytics function for sales intelligence
async function getSalesAnalytics() {
    if (!pool) return null;
    
    try {
        // Personality detection patterns
        const personalityPatterns = await pool.query(`
            SELECT 
                CASE 
                    WHEN user_message ILIKE '%party%' OR user_message ILIKE '%entertaining%' THEN 'entertainer'
                    WHEN user_message ILIKE '%budget%' OR user_message ILIKE '%cheap%' THEN 'budget_conscious'
                    WHEN user_message ILIKE '%design%' OR user_message ILIKE '%stylish%' THEN 'style_conscious'
                    WHEN user_message ILIKE '%family%' OR user_message ILIKE '%children%' THEN 'family_focused'
                    WHEN user_message ILIKE '%comfortable%' OR user_message ILIKE '%relax%' THEN 'comfort_seeker'
                    WHEN user_message ILIKE '%small%' OR user_message ILIKE '%compact%' THEN 'small_space'
                    ELSE 'unknown'
                END as personality_type,
                COUNT(*) as frequency
            FROM enhanced_chat_logs 
            WHERE handler = 'sales'
            AND timestamp >= NOW() - INTERVAL '30 days'
            GROUP BY personality_type
            ORDER BY frequency DESC
        `);
        
        // Sales conversation outcomes
        const salesOutcomes = await pool.query(`
            SELECT 
                session_id,
                COUNT(*) as message_count,
                BOOL_OR(ai_response ILIKE '%recommend%') as had_recommendation,
                BOOL_OR(ai_response ILIKE '%price%') as discussed_pricing,
                BOOL_OR(user_message ILIKE '%interested%' OR user_message ILIKE '%buy%') as showed_interest
            FROM enhanced_chat_logs 
            WHERE handler = 'sales'
            AND timestamp >= NOW() - INTERVAL '7 days'
            GROUP BY session_id
        `);
        
        // Handler routing effectiveness
        const handlerStats = await pool.query(`
            SELECT 
                handler,
                COUNT(*) as total_conversations,
                AVG(CASE WHEN escalated THEN 1.0 ELSE 0.0 END) as escalation_rate
            FROM enhanced_chat_logs 
            WHERE timestamp >= NOW() - INTERVAL '7 days'
            GROUP BY handler
        `);
        
        return {
            personalityPatterns: personalityPatterns.rows,
            salesOutcomes: salesOutcomes.rows,
            handlerStats: handlerStats.rows
        };
        
    } catch (error) {
        console.error('Sales analytics error:', error);
        return null;
    }
}

// Product interest tracking
async function trackProductInterest(sessionId, productName, interestLevel) {
    if (!pool) return;
    
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS product_interest (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255),
                product_name VARCHAR(255),
                interest_level VARCHAR(50),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await pool.query(`
            INSERT INTO product_interest (session_id, product_name, interest_level)
            VALUES ($1, $2, $3)
        `, [sessionId, productName, interestLevel]);
        
    } catch (error) {
        console.error('Product interest tracking error:', error);
    }
}

module.exports = {
    analyzeIntent,
    logConversation,
    getSalesAnalytics,
    trackProductInterest
};