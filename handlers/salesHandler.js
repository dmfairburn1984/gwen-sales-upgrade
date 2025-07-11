// handlers/salesHandler.js - Sales Intelligence with Personality Detection
const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

class SalesHandler {
    constructor() {
        this.productCatalog = this.loadProductCatalog();
        this.personalityProfiles = this.initializePersonalityProfiles();
    }
    
    loadProductCatalog() {
        // This would load your actual product catalog
        // For now, using sample MINT Outdoor products based on your docs
        return {
            "dining_sets": [
                {
                    "name": "Milan Outdoor Dining Set",
                    "price": 899,
                    "category": "dining",
                    "style": "modern",
                    "material": "aluminum",
                    "seats": 6,
                    "personality_match": ["entertainer", "style_conscious"]
                },
                {
                    "name": "Rustic Garden Dining Table",
                    "price": 649,
                    "category": "dining", 
                    "style": "rustic",
                    "material": "wood",
                    "seats": 4,
                    "personality_match": ["budget_conscious", "family_focused"]
                }
            ],
            "lounge_sets": [
                {
                    "name": "Luxury Rattan Corner Sofa",
                    "price": 1299,
                    "category": "lounge",
                    "style": "premium",
                    "material": "rattan",
                    "seats": 8,
                    "personality_match": ["entertainer", "comfort_seeker"]
                },
                {
                    "name": "Compact Bistro Set",
                    "price": 299,
                    "category": "small_space",
                    "style": "minimalist", 
                    "material": "metal",
                    "seats": 2,
                    "personality_match": ["budget_conscious", "small_space"]
                }
            ]
        };
    }
    
    initializePersonalityProfiles() {
        return {
            "entertainer": {
                "keywords": ["party", "guests", "entertaining", "friends", "dinner party", "barbecue", "social"],
                "preferences": ["large_sets", "premium_materials", "statement_pieces"],
                "messaging": "perfect for hosting and entertaining guests"
            },
            "budget_conscious": {
                "keywords": ["affordable", "budget", "cheap", "cost", "price", "deal", "sale"],
                "preferences": ["value_products", "essential_items", "multi_functional"],
                "messaging": "excellent value for money"
            },
            "style_conscious": {
                "keywords": ["design", "modern", "contemporary", "beautiful", "aesthetic", "trendy", "stylish"],
                "preferences": ["designer_pieces", "unique_styles", "statement_furniture"],
                "messaging": "stunning design that makes a statement"
            },
            "family_focused": {
                "keywords": ["family", "children", "kids", "durable", "practical", "safe"],
                "preferences": ["durable_materials", "family_sized", "easy_maintenance"],
                "messaging": "perfect for family life and built to last"
            },
            "comfort_seeker": {
                "keywords": ["comfortable", "relaxing", "cozy", "cushions", "soft", "chill"],
                "preferences": ["cushioned_sets", "lounge_furniture", "comfort_features"],
                "messaging": "designed for ultimate comfort and relaxation"
            },
            "small_space": {
                "keywords": ["small", "compact", "apartment", "balcony", "tiny", "space"],
                "preferences": ["compact_furniture", "multi_functional", "space_saving"],
                "messaging": "perfect for smaller outdoor spaces"
            }
        };
    }
    
    async handle(message, session) {
        try {
            // Detect personality if not already done
            if (!session.personality) {
                session.personality = this.detectPersonality(message, session.conversationHistory);
            }
            
            // Generate AI response with sales intelligence
            const response = await this.generateSalesResponse(message, session);
            
            return {
                message: response.message,
                personality: session.personality,
                suggestions: response.suggestions,
                context: response.context
            };
            
        } catch (error) {
            console.error('Sales handler error:', error);
            return {
                message: "I'd love to help you find the perfect outdoor furniture! What kind of space are you looking to furnish?",
                personality: null,
                suggestions: ["Dining sets", "Lounge furniture", "Small space solutions"]
            };
        }
    }
    
    detectPersonality(message, conversationHistory) {
        const allText = [message, ...conversationHistory.map(h => h.content)].join(' ').toLowerCase();
        
        const personalityScores = {};
        
        // Score each personality type based on keyword matches
        for (const [type, profile] of Object.entries(this.personalityProfiles)) {
            let score = 0;
            for (const keyword of profile.keywords) {
                if (allText.includes(keyword)) {
                    score += 1;
                }
            }
            personalityScores[type] = score;
        }
        
        // Return the personality with the highest score, or null if no clear match
        const maxScore = Math.max(...Object.values(personalityScores));
        if (maxScore > 0) {
            return Object.keys(personalityScores).find(key => personalityScores[key] === maxScore);
        }
        
        return null;
    }
    
    async generateSalesResponse(message, session) {
        // Build context for AI
        const conversationContext = session.conversationHistory.slice(-6).map(h => 
            `${h.role}: ${h.content}`
        ).join('\n');
        
        const personalityInfo = session.personality ? 
            `Customer personality: ${session.personality} (${this.personalityProfiles[session.personality]?.messaging})` : 
            'Customer personality: Not yet determined';
        
        // Get relevant products
        const recommendedProducts = this.getRecommendedProducts(session.personality, message);
        
        const prompt = `You are Gwen Johnson, a sales specialist for MINT Outdoor, a premium outdoor furniture company. You're confident, knowledgeable, and excellent at matching customers with perfect furniture.

COMPANY BACKGROUND:
- MINT Outdoor specializes in premium outdoor furniture
- Unique MINT DesignDrop model: Limited edition pre-orders (6-10 week delivery)
- MINT Essentials: In-stock items (5-10 day delivery)
- Prices 80% less than traditional retailers due to direct-from-factory model
- All designs exclusive to UK market

CUSTOMER CONTEXT:
${personalityInfo}

CONVERSATION HISTORY:
${conversationContext}

CURRENT MESSAGE: ${message}

AVAILABLE PRODUCTS TO RECOMMEND:
${JSON.stringify(recommendedProducts, null, 2)}

PERSONALITY-BASED SELLING APPROACH:
${session.personality ? this.getSalesApproach(session.personality) : 'Discover customer needs through questions'}

INSTRUCTIONS:
1. If customer asks about orders/delivery/returns, politely redirect to customer service
2. Focus on understanding their outdoor space and lifestyle needs
3. Make specific product recommendations based on their personality
4. Highlight the unique value proposition (designer furniture at 80% less cost)
5. Create urgency with limited edition model if appropriate
6. Be conversational and helpful, not pushy
7. Ask qualifying questions to understand their space and needs better

Respond as Gwen would, being helpful and knowledgeable while working toward a sale:`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 500,
            temperature: 0.7
        });
        
        const aiResponse = completion.choices[0].message.content;
        
        // Generate suggestions based on conversation flow
        const suggestions = this.generateSuggestions(message, session.personality);
        
        return {
            message: aiResponse,
            suggestions,
            context: {
                salesMode: true,
                recommendedProducts: recommendedProducts.map(p => p.name)
            }
        };
    }
    
    getSalesApproach(personality) {
        const approaches = {
            "entertainer": "Emphasize large sets, premium materials, and how furniture enhances entertaining experiences",
            "budget_conscious": "Focus on value proposition, competitive pricing, and cost savings vs traditional retailers",
            "style_conscious": "Highlight unique designs, exclusive UK availability, and aesthetic appeal",
            "family_focused": "Emphasize durability, safety, and practical features for family use",
            "comfort_seeker": "Focus on comfort features, relaxation benefits, and quality materials",
            "small_space": "Highlight compact designs, space efficiency, and multi-functional features"
        };
        
        return approaches[personality] || "Ask questions to understand customer needs and preferences";
    }
    
    getRecommendedProducts(personality, message) {
        let products = [];
        
        // Get all products and filter by personality match
        for (const category of Object.values(this.productCatalog)) {
            for (const product of category) {
                if (!personality || product.personality_match.includes(personality)) {
                    products.push(product);
                }
            }
        }
        
        // If no personality match, include budget-friendly options
        if (products.length === 0) {
            products = Object.values(this.productCatalog).flat().filter(p => p.price < 800);
        }
        
        // Limit to top 3 recommendations
        return products.slice(0, 3);
    }
    
    generateSuggestions(message, personality) {
        const baseSuggestions = [
            "Tell me about your outdoor space",
            "What's your budget range?",
            "Show me dining sets",
            "I need lounge furniture"
        ];
        
        const personalitySuggestions = {
            "entertainer": ["Large dining sets", "Hosting solutions", "Premium collections"],
            "budget_conscious": ["Best value products", "Current deals", "Budget-friendly options"],
            "style_conscious": ["Designer collections", "Modern styles", "Statement pieces"],
            "family_focused": ["Family dining sets", "Durable materials", "Safe options"],
            "comfort_seeker": ["Comfort seating", "Relaxation furniture", "Cushioned sets"],
            "small_space": ["Compact sets", "Bistro furniture", "Space-saving solutions"]
        };
        
        if (personality && personalitySuggestions[personality]) {
            return personalitySuggestions[personality];
        }
        
        return baseSuggestions;
    }
}

module.exports = SalesHandler;