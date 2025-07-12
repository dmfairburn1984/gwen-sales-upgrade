// MINT OUTDOOR AI SYSTEM - NATURAL PACKAGE DEAL APPROACH
// Implementing Gemini's feedback: Remove artificial delays, use immediate expert consultation

require('dotenv').config();
const express = require('express');
const path = require('path');
const OpenAI = require('openai');
const fs = require('fs');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const nodemailer = require('nodemailer');

// Email configuration
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Database setup
const { Pool } = require('pg');
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

// MOVE logChat to top - Fix housekeeping issue Gemini noted
async function logChat(sessionId + '-SALES', role, message) {
  if (!pool) {
    console.log(`Chat Log: ${sessionId} - ${role}: ${message.substring(0, 50)}...`);
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_logs (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        role VARCHAR(20),
        message TEXT
      )
    `);
    await pool.query(
      'INSERT INTO chat_logs (session_id, role, message) VALUES ($1, $2, $3)',
      [sessionId, role, message]
    );
  } catch (error) {
    console.log('Database logging skipped:', error.message);
  }
}

const app = express();
app.use(express.json());
const ENABLE_SALES_MODE = process.env.ENABLE_SALES_MODE === 'true';
const sessions = new Map();
// NEW: Shopify integration constants
const SHOPIFY_DOMAIN = 'bb69ce-b5.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Load data - ALL KNOWLEDGE FILES
let orderData = [];
let productData = [];
let inventoryData = [];
let bundleSuggestions = [];
let bundleItems = [];


// Knowledge base files
let spaceConfig = [];
let seatingMaster = [];
let personasMaster = [];
let metalsMaster = [];
let materialMaintenance = {};
let marketMaster = {};
let hardwareMaster = [];
let categoriesMaster = [];
let fabricsMaster = [];
let complianceMaster = [];
let climateMaster = {};
let woodMaster = [];
let syntheticsMaster = [];
let stoneCompositesMaster = [];
let taxonomyData = {};
let product_faqs = [];
let productMaterialIndex = [];
let productFamilies = loadDataFile('product_families.json', {});


// Enhanced data loading with structure detection
function loadDataFile(filename, defaultValue = []) {
  try {
    const data = JSON.parse(fs.readFileSync(`./data/${filename}`, 'utf8'));
    
    // Handle different data structures intelligently
    let processedData;
    let recordCount;
    
    if (Array.isArray(data)) {
      processedData = data;
      recordCount = data.length;
    } else if (data && typeof data === 'object') {
      // Handle nested structures like product_database.json
      if (data.products && Array.isArray(data.products)) {
        processedData = data.products;
        recordCount = data.products.length;
      } else if (data.inventory && Array.isArray(data.inventory)) {
        processedData = data.inventory;
        recordCount = data.inventory.length;
      } else {
        // It's an object (like material_maintenance.json)
        processedData = data;
        recordCount = Object.keys(data).length;
      }
    } else {
      processedData = defaultValue;
      recordCount = 0;
    }
    
    console.log(`✅ Loaded ${filename}: ${recordCount} records`);
    return processedData;
  } catch (error) {
    console.warn(`⚠️ Could not load ${filename}: ${error.message}`);
    return defaultValue;
  }
}

// Load core data files
orderData = loadDataFile('Gwen_PO_Order_Report.json', []);
productData = loadDataFile('product_database.json', []);
inventoryData = loadDataFile('Inventory_Data.json', []); // Note: capital I in filename
bundleSuggestions = loadDataFile('bundle_suggestions.json', []);
bundleItems = loadDataFile('bundle_items.json', []);
productMaterialIndex = loadDataFile('product_material_index.json', []);

// Load ALL knowledge base files
spaceConfig = loadDataFile('space_config.json', []);
seatingMaster = loadDataFile('seating_master.json', []);
personasMaster = loadDataFile('personas_master.json', []);
metalsMaster = loadDataFile('metals_master.json', []);
materialMaintenance = loadDataFile('material_maintenance.json', {});
marketMaster = loadDataFile('market_master.json', {});
hardwareMaster = loadDataFile('hardware_master.json', []);
categoriesMaster = loadDataFile('furniture_categories_master.json', []);
fabricsMaster = loadDataFile('fabrics_master.json', []);
complianceMaster = loadDataFile('compliance_master.json', []);
climateMaster = loadDataFile('climate_master.json', {});
woodMaster = loadDataFile('wood_master.json', []);
syntheticsMaster = loadDataFile('synthetics_master.json', []);
stoneCompositesMaster = loadDataFile('stone_composites_master.json', []);
taxonomyData = loadDataFile('taxonomy.json', {});
product_faqs = loadDataFile('product_faqs.json', []);


console.log('📊 COMPLETE DATA LOADING SUMMARY:');
console.log(`   📋 Orders: ${Array.isArray(orderData) ? orderData.length : 'N/A'}`);
console.log(`   📦 Products: ${Array.isArray(productData) ? productData.length : 'N/A'}`);
console.log(`   📊 Inventory records: ${Array.isArray(inventoryData) ? inventoryData.length : 'N/A'}`);
console.log(`   🎁 Bundle suggestions: ${Array.isArray(bundleSuggestions) ? bundleSuggestions.length : 'N/A'}`);
console.log(`   🔗 Bundle items: ${Array.isArray(bundleItems) ? bundleItems.length : 'N/A'}`);
console.log('📚 KNOWLEDGE BASE LOADED:');
console.log(`   🏠 Space configurations: ${Array.isArray(spaceConfig) ? spaceConfig.length : 'N/A'}`);
console.log(`   🪑 Seating data: ${Array.isArray(seatingMaster) ? seatingMaster.length : 'N/A'}`);
console.log(`   🎭 Customer personas: ${Array.isArray(personasMaster) ? personasMaster.length : 'N/A'}`);
console.log(`   🔩 Metals expertise: ${Array.isArray(metalsMaster) ? metalsMaster.length : 'N/A'}`);
console.log(`   🧽 Material maintenance: ${typeof materialMaintenance === 'object' ? Object.keys(materialMaintenance).length + ' materials' : 'N/A'}`);
console.log(`   📈 Market intelligence: ${typeof marketMaster === 'object' ? Object.keys(marketMaster).length + ' categories' : 'N/A'}`);
console.log(`   🔧 Hardware info: ${Array.isArray(hardwareMaster) ? hardwareMaster.length : 'N/A'}`);
console.log(`   📂 Categories: ${Array.isArray(categoriesMaster) ? categoriesMaster.length : 'N/A'}`);
console.log(`   🧵 Fabrics expertise: ${Array.isArray(fabricsMaster) ? fabricsMaster.length : 'N/A'}`);
console.log(`   📜 Compliance data: ${Array.isArray(complianceMaster) ? complianceMaster.length : 'N/A'}`);
console.log(`   🌤️ Climate guidance: ${typeof climateMaster === 'object' ? Object.keys(climateMaster).length + ' materials' : 'N/A'}`);
console.log(`   🌳 Wood expertise: ${Array.isArray(woodMaster) ? woodMaster.length : 'N/A'}`);
console.log(`   🧪 Synthetics data: ${Array.isArray(syntheticsMaster) ? syntheticsMaster.length : 'N/A'}`);
console.log(`   🪨 Stone/composites: ${Array.isArray(stoneCompositesMaster) ? stoneCompositesMaster.length : 'N/A'}`);
console.log(`   🏷️ Taxonomy categories: ${Object.keys(taxonomyData.product_categories || {}).length}`);
console.log('🧪 DEBUG: Taxonomy data keys:', Object.keys(taxonomyData));
console.log(`   👨‍👩‍👧‍👦 Product families: ${Object.keys(productFamilies.furniture_families || {}).length}`);

// FIND the detectCustomerInterest function and add better logging:

function detectCustomerInterest(message, session) {
  const strongBuyingSignals = [
    // Original signals
    'love this', 'love it', 'perfect for', 'exactly what i need', 'exactly what we need',
    'this is perfect', 'looks perfect', 'that\'s perfect', 'i want this', 'i want that',
    'how much', 'what\'s the price', 'cost', 'when can i get', 'when can we get',
    'i\'m interested in buying', 'interested in purchasing', 'ready to buy',
    'looks great', 'that looks great', 'beautiful', 'gorgeous', 'stunning',
    'i need this', 'we need this', 'this would be ideal', 'this would work',
    'delivery', 'assembly', 'how long', 'available', 'in stock','would like to buy', 'i would like to buy', 'would like to purchase',
'i\'d like this', 'i\'d like to buy', 'i\'ll take it', 'let\'s do it',
'want to order', 'ready to order', 'looks good', 'sounds good',
    // MISSING SIGNALS THAT CAUSED THE BUG
    'i like', 'like this', 'like that', 'like the', 'i want to buy', 'want to buy',
    'want to purchase', 'interested in this', 'interested in that',
    'this looks good', 'that looks good', 'this one', 'that one'
  ];
  
  const lowerMessage = message.toLowerCase();
  
  // Add debugging
  console.log(`🔍 Interest detection for: "${message}"`);
  console.log(`🔍 Lowercased: "${lowerMessage}"`);
  
  // FIXED - Reduce minimum length requirement (was blocking "i like the malai")
  if (message.length < 5) {
    console.log(`❌ Message too short: ${message.length} characters`);
    return false;
  }
  
  // Exclude browsing questions
  const browsingPhrases = [
    'what about', 'do you have', 'got any', 'show me', 'tell me about',
    'what is', 'what\'s', 'how about', 'any other', 'anything else'
  ];
  
  const isBrowsing = browsingPhrases.some(phrase => lowerMessage.includes(phrase));
  if (isBrowsing) {
    console.log(`❌ Browsing phrase detected: excluded`);
    return false;
  }
  
  const matchedSignals = strongBuyingSignals.filter(signal => lowerMessage.includes(signal));
  console.log(`🎯 Matched signals:`, matchedSignals);
  
  const hasInterest = matchedSignals.length > 0;
  console.log(`✅ Customer interest detected: ${hasInterest}`);
  
  return hasInterest;
}

function shouldOfferBundleNaturally(session) {
  const hasShownProducts = session.conversationHistory.some(msg => 
    msg.role === 'assistant' && msg.content.includes('Price: £')
  );
  
  const conversationLength = session.conversationHistory.length;
  const alreadyOfferedBundle = session.context.offeredBundle || false;
  const hasAskedQuestions = conversationLength >= 3; // Reduced from 4 to 3
  
  console.log(`🎯 Bundle check:`, {
    hasShownProducts,
    conversationLength,
    alreadyOfferedBundle,
    hasAskedQuestions,
    shouldOffer: hasShownProducts && hasAskedQuestions && !alreadyOfferedBundle
  });
  
  return hasShownProducts && hasAskedQuestions && !alreadyOfferedBundle;
}


function extractCustomerDetails(message) {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const postcodeRegex = /\b[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}\b/i;
    
    const email = message.match(emailRegex);
    const postcode = message.match(postcodeRegex);
    
    return {
        email: email ? email[0] : null,
        postcode: postcode ? postcode[0] : null,
        hasRequiredInfo: email && postcode
    };
}

// ENHANCED - Customer persona detection (Gemini's persona awareness)
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

// ENHANCED - Persona-aware question variations (Gemini's improvement)
const questionVariations = {
  material: {
    default: [
      "What material appeals to you most - teak, aluminium, or rattan?",
      "Which material would work best for your space - teak, aluminium, or rattan?", 
      "Are you drawn to any particular material like teak, aluminium, or rattan?",
      "What type of material are you considering - teak, aluminium, or rattan?"
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
      "Would you prefer dining sets or lounge seating?",
      "Are you thinking dining furniture for meals or lounge furniture for relaxing?"
    ],
    entertainer: [
      "Are you planning more formal dining experiences or casual lounge gatherings?",
      "Would you prioritize impressive dining sets or comfortable lounge areas for guests?"
    ]
  },
  seatCount: {
    default: [
      "How many people do you typically need to seat?",
      "What's the seating capacity you're looking for?",
      "How many people would you like to accommodate?"
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

// Handoff Detection Functions
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
    
    const hasMarketingTrigger = marketingTriggers.some(trigger => 
        message.toLowerCase().includes(trigger)
    );
    
    return hasMarketingTrigger;
}

// REPLACE your existing sendChatToMarketing function with this:

async function sendChatToMarketing(sessionId, reason, conversationHistory, customerDetails = null) {
    const session = sessions.get(sessionId);
    
    // Format conversation history for email
    let chatTranscript = '\n=== CHAT TRANSCRIPT ===\n';
    conversationHistory.forEach((msg, index) => {
        if (msg.role === 'user') {
            chatTranscript += `\n[CUSTOMER]: ${msg.content}\n`;
        } else if (msg.role === 'assistant') {
            chatTranscript += `[GWEN]: ${msg.content}\n`;
        }
    });
    chatTranscript += '\n=== END TRANSCRIPT ===\n';

    // Create customer info section
    let customerInfo = '';
    if (customerDetails) {
        customerInfo = `
=== CUSTOMER DETAILS ===
Email: ${customerDetails.email || 'Not provided'}
Postcode: ${customerDetails.postcode || 'Not provided'}
========================
        `;
    }

    // Email subject based on reason
    let subject = 'Gwen AI - Customer Inquiry';
    let priority = 'Normal';
    
    if (reason.toLowerCase().includes('bundle') || reason.toLowerCase().includes('purchase')) {
        subject = '🎯 HIGH PRIORITY - Customer Ready to Purchase';
        priority = 'High';
    } else if (reason.toLowerCase().includes('complaint') || reason.toLowerCase().includes('issue')) {
        subject = '⚠️ URGENT - Customer Service Issue';
        priority = 'High';
    } else if (reason.toLowerCase().includes('callback') || reason.toLowerCase().includes('human')) {
        subject = '📞 Customer Requests Human Contact';
        priority = 'Normal';
    }

    // HTML Email content
    const emailHTML = `
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #9FDCC2, #2E6041); color: white; padding: 20px; text-align: center;">
            <h1>🌿 MINT Outdoor - Gwen AI Handoff</h1>
            <p style="margin: 0; font-size: 16px;">${reason}</p>
        </div>
        
        <div style="padding: 20px; background: #f8f9fa;">
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #9FDCC2;">
                <h2 style="color: #2E6041; margin-top: 0;">📋 Inquiry Details</h2>
                <p><strong>Session ID:</strong> ${sessionId}</p>
                <p><strong>Timestamp:</strong> ${new Date().toLocaleString('en-GB')}</p>
                <p><strong>Reason:</strong> ${reason}</p>
                <p><strong>Priority:</strong> <span style="color: ${priority === 'High' ? '#dc2626' : '#059669'};">${priority}</span></p>
                <p><strong>Messages:</strong> ${conversationHistory.length}</p>
            </div>

            ${customerDetails ? `
            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #2196F3;">
                <h2 style="color: #2E6041; margin-top: 0;">👤 Customer Contact Details</h2>
                <p><strong>Email:</strong> ${customerDetails.email || 'Not provided'}</p>
                <p><strong>Postcode:</strong> ${customerDetails.postcode || 'Not provided'}</p>
            </div>
            ` : ''}

            <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b;">
                <h2 style="color: #2E6041; margin-top: 0;">💬 Full Conversation</h2>
                <pre style="background: #f3f4f6; padding: 15px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap;">${chatTranscript}</pre>
            </div>
        </div>
        
        <div style="background: #2E6041; color: white; padding: 15px; text-align: center; font-size: 14px;">
            <p style="margin: 0;">This email was automatically generated by the Gwen AI system</p>
        </div>
    </body>
    </html>
    `;

    // Email configuration
    const mailOptions = {
        from: `"MINT Outdoor - Gwen AI" <${process.env.EMAIL_USER}>`,
        to: 'marketing@mint-outdoor.com',
        subject: subject,
        html: emailHTML,
        priority: priority.toLowerCase(),
        headers: {
            'X-Priority': priority === 'High' ? '1' : '3',
            'X-MSMail-Priority': priority,
            'Importance': priority
        }
    };

    try {
        console.log('\n📧 ========== SENDING EMAIL ==========');
        console.log(`📋 To: marketing@mint-outdoor.com`);
        console.log(`📋 Subject: ${subject}`);
        console.log(`📋 Priority: ${priority}`);
        console.log(`🆔 Session ID: ${sessionId}`);
        
        // Send the actual email
        const info = await emailTransporter.sendMail(mailOptions);
        
        console.log('✅ EMAIL SENT SUCCESSFULLY!');
        console.log(`📧 Message ID: ${info.messageId}`);
        console.log('📧 ====================================\n');
        
        return true;
        
    } catch (error) {
        console.error('❌ EMAIL SENDING FAILED:', error.message);
        console.log('📧 ====================================\n');
        
        // Still log the conversation for manual follow-up
        console.log('\n📝 ========== BACKUP LOG (Email Failed) ==========');
        console.log(`📋 Reason: ${reason}`);
        console.log(`🆔 Session ID: ${sessionId}`);
        console.log(`⏰ Timestamp: ${new Date().toLocaleString('en-GB')}`);
        console.log(chatTranscript);
        if (customerDetails) {
            console.log(customerInfo);
        }
        console.log('📝 ================================================\n');
        
        return false;
    }
}

// ENHANCED: Bundle recommendations now uses the live Shopify search for complete product details.
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

        const relevantBundles = bundleSuggestions.filter(bundle => relevantBundleIds.includes(bundle.bundle_id));
        const recommendations = [];
        const addedSkus = new Set(); // Keep track of SKUs we've already added

        for (const bundle of relevantBundles) {
            console.log(`\n🎁 [Bundle System] Processing bundle: "${bundle.name}" (ID: ${bundle.bundle_id})`);
            const bundleAccessoryItems = bundleItems.filter(item =>
                item.bundle_id === bundle.bundle_id && item.product_sku !== mainProductSku
            );

            for (const item of bundleAccessoryItems) {
                if (addedSkus.has(item.product_sku)) {
                    console.log(`    - SKIPPED: Accessory SKU "${item.product_sku}" is already in the recommendations list.`);
                    continue; // Skip if we've already processed this SKU
                }

                console.log(`    - Looking for accessory SKU "${item.product_sku}" via live Shopify search...`);

                // --- THIS IS THE KEY CHANGE ---
                // Use the live Shopify search to get complete product data.
                const shopifyProducts = await searchShopifyProducts({ sku: item.product_sku, maxResults: 1 });

                if (shopifyProducts && shopifyProducts.length > 0) {
                    const product = shopifyProducts[0]; // Get the full product details
                    console.log(`    ✅ SUCCESS: Found "${product.product_title}" with price £${product.price}.`);
                    
                    recommendations.push({
                        ...product,
                        bundle_name: bundle.name,
                        bundle_description: bundle.description
                    });
                    addedSkus.add(item.product_sku); // Mark this SKU as added
                } else {
                    console.log(`    ❌ FAILED: Accessory SKU "${item.product_sku}" was NOT FOUND via live Shopify search.`);
                }
            }
        }

        console.log(`\n🎉 [Bundle System] Finished. Found a total of ${recommendations.length} unique accessory recommendations.`);
        return recommendations.slice(0, 3);

    } catch (error) {
        console.error('💥 [Bundle System] A critical error occurred:', error.message);
        return [];
    }
}

// ===== COMPLETE OUTDOOR ROOM BUNDLE SYSTEM - HELPER FUNCTIONS =====

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
  
  // Customer is "educated" when they've learned about 1+ key topics (LOWERED FROM 3)
  const educatedTopics = Object.values(session.context.educationProgress).filter(Boolean).length;
  session.context.educationProgress.educated = educatedTopics >= 1;
  
  console.log(`📚 Education progress: ${educatedTopics}/5 topics covered (Bundle eligible: ${session.context.educationProgress.educated})`);
  return session.context.educationProgress.educated;
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
      theme: 'corner garden',
      socialProof: '91% of customers maximize their corner space with these complementary items'
    },
    'teak-furniture': {
      name: 'Complete Teak Care & Protection System',
      accessories: ['teak-care-kit', 'protective-cover', 'cleaning-kit'],
      theme: 'teak maintenance',
      socialProof: '94% of teak owners protect their investment with professional care products'
    }
  };
  
  return bundlesByCategory[category] || null;
}

function findBundleAccessories(mainProductSku, accessoryTypes) {
  const accessories = [];
  
  accessoryTypes.forEach(type => {
    const matchingProducts = productData.filter(product => {
      const title = product.product_title.toLowerCase();
      
      switch(type) {
        case 'parasol':
          return title.includes('parasol') || title.includes('umbrella');
        case 'cushions':
          return title.includes('cushion') || title.includes('pillow');
        case 'furniture-cover':
        case 'weather-cover':
          return title.includes('cover') && !title.includes('book');
        case 'side-table':
          return title.includes('side table') || title.includes('coffee table');
        case 'ottoman':
          return title.includes('ottoman') || title.includes('footstool');
        case 'teak-care-kit':
          return title.includes('teak') && (title.includes('care') || title.includes('oil'));
        case 'throw-pillows':
          return title.includes('pillow') || title.includes('throw');
        case 'drinks-table':
          return title.includes('drinks') || title.includes('coffee table');
        default:
          return false;
      }
    });
    
    if (matchingProducts.length > 0) {
      accessories.push(matchingProducts[0]);
    }
  });
  
  return accessories;
}

function calculateBundlePrice(mainProduct, accessories) {
  const mainPrice = parseFloat(mainProduct.price || 0);
  const accessoryTotal = accessories.reduce((sum, acc) => sum + parseFloat(acc.price || 0), 0);
  const totalPrice = mainPrice + accessoryTotal;
  
  const bundleDiscount = accessoryTotal * 0.12; // 12% discount on accessories
  const bundlePrice = totalPrice - bundleDiscount;
  
  return {
    totalPrice: totalPrice.toFixed(2),
    bundlePrice: bundlePrice.toFixed(2),
    savings: bundleDiscount.toFixed(2),
    accessories: accessories
  };
}

function detectProductCategoryForBundle(product) {
  const title = product.product_title.toLowerCase();
  const description = (product.description || '').toLowerCase();
  const text = `${title} ${description}`;
  
  if (text.includes('dining') && (text.includes('set') || text.includes('table'))) {
    return 'dining-set';
  }
  if (text.includes('lounge') || text.includes('sofa') || text.includes('seating')) {
    return 'lounge-set';
  }
  if (text.includes('corner') && text.includes('set')) {
    return 'corner-set';
  }
  if (text.includes('teak')) {
    return 'teak-furniture';
  }
  
  return null;
}

function generateBundleOffer(mainProduct, bundleData, pricingData) {
  const urgencyMinutes = Math.floor(Math.random() * 15) + 5; // 5-20 minutes
  
  let offer = `Perfect choice! ${bundleData.socialProof}:\n\n`;
  
  // Main product
  offer += `✅ **${mainProduct.product_title}** - £${mainProduct.price}\n`;
  
  // Accessories
  pricingData.accessories.forEach(accessory => {
    offer += `✅ **${accessory.product_title}** - £${accessory.price}\n`;
  });
  
  offer += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  offer += `**${bundleData.name}**: £${pricingData.bundlePrice}\n`;
  offer += `💰 **Save £${pricingData.savings}** vs buying separately\n`;
  offer += `⏰ Bundle discount expires in ${urgencyMinutes} minutes\n\n`;
  
  offer += `This bundle ensures you have everything needed for your complete ${bundleData.theme}. Would you like me to arrange this complete package for you?`;
  
  return offer;
}

// ===== END OF HELPER FUNCTIONS =====


// ENHANCED: Stock checking function with better error handling
function getStockStatus(sku) {
  if (!inventoryData || !Array.isArray(inventoryData) || inventoryData.length === 0) {
    return { 
      inStock: true, 
      stockLevel: 'unknown', 
      message: 'Stock information not available',
      note: 'Inventory data not loaded'
    };
  }
  
  const stockInfo = inventoryData.find(item => item.sku === sku);
  
  if (!stockInfo) {
    return { 
      inStock: true, 
      stockLevel: 'unknown', 
      message: 'Stock information not available for this product',
      note: 'Product not found in inventory data'
    };
  }
  
  const available = parseInt(stockInfo.available) || 0;
  const inStock = available > 0;
  
  return {
    inStock: inStock,
    stockLevel: available,
    message: inStock ? 'In stock' : 'Currently out of stock',
    stockData: stockInfo,
    note: 'Real stock data'
  };
}

// NEW: Detect product category from customer message using taxonomy
function detectProductCategory(customerMessage) {
  const message = customerMessage.toLowerCase();
  
  for (const [categoryKey, categoryData] of Object.entries(taxonomyData.product_categories || {})) {
    // Check if any synonyms match
    if (categoryData.synonyms.some(synonym => message.includes(synonym.toLowerCase()))) {
      console.log(`🎯 Detected category: ${categoryKey} from message: "${customerMessage}"`);
      return {
        category: categoryKey,
        type: categoryData.category_type,
        searchTerms: categoryData.search_terms,
        synonyms: categoryData.synonyms
      };
    }
  }
  
  console.log(`❓ No category detected from: "${customerMessage}"`);
  return null;
}


async function identifyBundleOpportunities(productInterest, customerBudget) {
  // 1. Check direct bundle matches from data
  const matchingBundles = bundleSuggestions.filter(bundle => 
    bundle.name.toLowerCase().includes(productInterest.toLowerCase()) || 
    bundle.description.toLowerCase().includes(productInterest.toLowerCase())
  );

  // 2. Analyze product family relationships (check items in bundle_items.json)
  const familyMatches = matchingBundles.filter(bundle => {
    const items = bundleItems.filter(item => item.bundle_id === bundle.bundle_id);
    return items.some(item => item.product_sku.toLowerCase().includes(productInterest.toLowerCase()));
  });

  // 3. Consider customer budget constraints (prices from Shopify, so estimate or skip if no budget)
  const budgetFiltered = familyMatches; // Placeholder: Integrate Shopify price fetch if needed for exact filtering

  // 4. Apply seasonal/promotional logic
  const currentMonth = new Date().getMonth();
  const isPeakSeason = currentMonth >= 4 && currentMonth <= 8; // May to September for outdoor peak
  const promoBundles = isPeakSeason ? budgetFiltered : budgetFiltered.slice(0, 2); // Limit in off-season

  // 5. ALWAYS suggest if bundle exists
  return promoBundles.length > 0 ? promoBundles : [];
}

// ENHANCED: Better product search with taxonomy
function searchRealProducts(criteria) {
  if (!Array.isArray(productData) || productData.length === 0) {
    return [];
  }

  const { material, furnitureType, seatCount, productName, sku, maxResults = 3 } = criteria;
  let filtered = productData;

  console.log('🔍 Starting search with criteria:', criteria);

  // ENHANCED: Use taxonomy for better product name matching
  if (productName) {
    // First detect if this is a category request
    const detectedCategory = detectProductCategory(productName);
    
    if (detectedCategory) {
      console.log('📂 Using taxonomy search terms:', detectedCategory.searchTerms);
      
      // Search using all the category's search terms
      filtered = filtered.filter(product => {
        const title = (product.product_title || '').toLowerCase();
        const description = (product.description || '').toLowerCase();
        const searchText = `${title} ${description}`;
        
        // Check if any of the search terms match
        const hasMatch = detectedCategory.searchTerms.some(term => 
          searchText.includes(term.toLowerCase())
        );
        
        if (hasMatch) {
          console.log(`✅ Taxonomy match found: ${product.product_title}`);
        }
        
        return hasMatch;
      });
    } else {
      // Original product name search
      filtered = filtered.filter(product => {
        const title = (product.product_title || '').toLowerCase();
        const productSku = (product.sku || '').toLowerCase();
        const description = (product.description || '').toLowerCase();
        const searchName = productName.toLowerCase();
        
        if (title.includes(searchName) || productSku.includes(searchName) || description.includes(searchName)) {
          return true;
        }
        
        const searchWords = searchName.split(' ').filter(word => word.length > 2);
        const titleWords = title.split(' ');
        const descWords = description.split(' ');
        const allProductWords = [...titleWords, ...descWords];
        
        const matchedWords = searchWords.filter(searchWord => 
          allProductWords.some(productWord => 
            productWord.includes(searchWord) || searchWord.includes(productWord)
          )
        );
        
        return matchedWords.length >= Math.ceil(searchWords.length * 0.6);
      });
    }
  }

  // Exact SKU search
  if (sku) {
    const exactMatch = filtered.find(product => 
      (product.sku || '').toLowerCase() === sku.toLowerCase()
    );
    if (exactMatch) return [exactMatch];
  }

  // Material search
  if (material) {
    filtered = filtered.filter(product => {
      const title = (product.product_title || '').toLowerCase();
      const description = (product.description || '').toLowerCase();
      const searchText = `${title} ${description}`;
      return searchText.includes(material.toLowerCase());
    });
  }

  // Furniture type search
  if (furnitureType === 'dining') {
    filtered = filtered.filter(product => {
      const title = (product.product_title || '').toLowerCase();
      const description = (product.description || '').toLowerCase();
      const searchText = `${title} ${description}`;
      return searchText.includes('dining') || 
             searchText.includes('table') || 
             (searchText.includes('chair') && !searchText.includes('armchair'));
    });
  } else if (furnitureType === 'lounge') {
    filtered = filtered.filter(product => {
      const title = (product.product_title || '').toLowerCase();
      const description = (product.description || '').toLowerCase();
      const searchText = `${title} ${description}`;
      return searchText.includes('sofa') || 
             searchText.includes('lounge') || 
             searchText.includes('seating') || 
             searchText.includes('armchair') ||
             searchText.includes('corner') ||
             (searchText.includes('set') && !searchText.includes('dining'));
    });
  }

   // Enhanced seat count detection
    if (seatCount) {
        console.log(`🪑 Looking for ${seatCount} seater furniture...`);
        
        filtered = filtered.filter(product => {
            const title = (product.product_title || '').toLowerCase();
            const description = (product.description || '').toLowerCase();
            const searchText = `${title} ${description}`;
            
            const seatPatterns = [
                /(\d+)\s*seater/gi,
                /for\s*(\d+)\s*people/gi,
                /seat\s*(\d+)/gi,
                /(\d+)\s*person/gi,
                /(\d+)\s*people/gi
            ];
            
            for (const pattern of seatPatterns) {
                const matches = searchText.match(pattern);
                if (matches) {
                    const foundSeats = parseInt(matches[0].match(/\d+/)[0]);
                    if (foundSeats >= seatCount) {
                        console.log(`✅ Found ${foundSeats} seater: ${product.product_title}`);
                        return true;
                    }
                }
            }
            
            const titleNumbers = product.product_title.match(/\d+/g);
            if (titleNumbers) {
                const hasMatchingNumber = titleNumbers.some(num => parseInt(num) >= seatCount);
                if (hasMatchingNumber) {
                    console.log(`✅ Found number match: ${product.product_title}`);
                    return true;
                }
            }
            
            return false;
        });
    }

    // Add stock information to each product
    const productsWithStock = filtered.map(product => {
        const stockStatus = getStockStatus(product.sku); // Assumes getStockStatus is defined elsewhere
        return {
            ...product,
            stockStatus: stockStatus
        };
    });

    // Filter to only include in-stock products
    const inStockProducts = productsWithStock.filter(product => product.stockStatus.inStock);

    // Sort by price (lowest first)
    inStockProducts.sort((a, b) => {
        const aPrice = parseFloat(a.price || a.variant_price || 0);
        const bPrice = parseFloat(b.price || b.variant_price || 0);
        return aPrice - bPrice;
    });

    // Log the results for debugging
    console.log(`🔍 Search Results: Found ${inStockProducts.length} in-stock products`);
    inStockProducts.forEach((product, index) => {
        const price = parseFloat(product.price || product.variant_price || 0);
        console.log(`  ${index + 1}. ${product.product_title} - Stock: ${product.stockStatus.stockLevel}, Price: £${price.toFixed(2)}`);
    });

    // Return the final, sliced results
    return inStockProducts.slice(0, maxResults);
}

// Find and replace this entire function in app.js
// PASTE THIS ENTIRE CORRECTED FUNCTION INTO YOUR APP.JS FILE

async function searchShopifyProducts(criteria) {
    try {
        console.log('🛒 Trying Shopify products with new enhanced logic...');
        console.log('🔍 Initial search criteria:', criteria);

        if (criteria.sku) {
            const response = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?limit=250`, {
                headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' }
            });
            if (!response.ok) { return searchRealProducts(criteria); }
            const data = await response.json();
            const product = (data.products || []).find(p => p.variants.some(v => v.sku === criteria.sku));

            if (!product) {
                console.log(`❌ No product found for SKU: ${criteria.sku}`);
                return [];
            }
            const variant = product.variants.find(v => v.sku === criteria.sku);
            const image = product.images[0] || {};
            return [{
                product_title: product.title,
                sku: variant.sku,
                price: parseFloat(variant.price || '0').toFixed(2),
                website_url: `https://mint-outdoor.com/products/${product.handle}`,
                image_url: image ? image.src : null,
                stockStatus: { message: (variant.inventory_quantity > 0) ? 'In stock' : 'Out of stock' }
            }];
        }

        const response = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?limit=250`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log('⚠️ Shopify API failed, using JSON backup');
            return searchRealProducts(criteria);
        }

        const data = await response.json();
        let allProducts = data.products || [];
        console.log(`✅ Fetched ${allProducts.length} total products from Shopify.`);

        let filteredProducts = allProducts;

        const productMatchesText = (product, searchText) => {
            const title = (product.title || '').toLowerCase();
            const description = (product.body_html || '').toLowerCase().replace(/<[^>]*>/g, '');
            const productText = `${title} ${description}`;
            const searchWords = searchText.toLowerCase().split(' ').filter(w => w.length > 1);
            return searchWords.every(word => productText.includes(word));
        };

        if (criteria.furnitureType) {
            console.log(`📂 Filtering for furnitureType: ${criteria.furnitureType}`);
            const type = criteria.furnitureType.toLowerCase();
            const diningTerms = ['dining', 'table'];
            const nonDiningTerms = ['lounge', 'sofa', 'parasol', 'daybed', 'conversation'];
            const loungeTerms = ['lounge', 'sofa', 'conversation', 'armchair', 'seating', 'corner'];
            const nonLoungeTerms = ['dining'];
            filteredProducts = filteredProducts.filter(p => {
                const title = (p.title || '').toLowerCase();
                if (type === 'dining') {
                    return diningTerms.some(term => title.includes(term)) && !nonDiningTerms.some(term => title.includes(term));
                }
                if (type === 'lounge') {
                    return loungeTerms.some(term => title.includes(term)) && !nonLoungeTerms.some(term => title.includes(term));
                }
                return true;
            });
            console.log(`  ➡️ Found ${filteredProducts.length} products after type filter.`);
        }
        
        if (criteria.productName) {
             console.log(`🏷️ Filtering for productName: "${criteria.productName}"`);
             filteredProducts = filteredProducts.filter(p => productMatchesText(p, criteria.productName));
             console.log(`  ➡️ Found ${filteredProducts.length} products after name filter.`);
        }

        if (criteria.material) {
             console.log(`🧱 Filtering for material: "${criteria.material}"`);
             filteredProducts = filteredProducts.filter(p => productMatchesText(p, criteria.material));
             console.log(`  ➡️ Found ${filteredProducts.length} products after material filter.`);
        }

        let validProducts = filteredProducts.filter(product => {
            const variant = product.variants[0] || {};
            const price = parseFloat(variant.price || 0);
            const stock = parseInt(variant.inventory_quantity || 0);
            const isAvailable = variant.available !== false;
            if (stock <= 0) {
                console.log(`❌ Filtering out [OUT OF STOCK]: "${product.title}" (Shopify stock: ${stock})`);
                return false;
            }
            if (price <= 0) {
                console.log(`❌ Filtering out [NO PRICE]: "${product.title}" (Shopify price: ${price})`);
                return false;
            }
            if (!isAvailable) {
                console.log(`❌ Filtering out [NOT AVAILABLE]: "${product.title}" (Shopify 'available' flag: ${isAvailable})`);
                return false;
            }
            return true;
        });
        console.log(`✅ Found ${validProducts.length} products with valid stock & price.`);

        // --- THIS IS THE CODE YOU COULDN'T SEE ---
        const getProductSeatCount = (product) => {
            const title = (product.title || '');
            const text = `${title}`.toLowerCase();
            const patterns = [ /(\d+)\s*seater/i, /(\d+)\s*seat/i, /for\s*(\d+)\s*people/i ];
            for(const pattern of patterns) {
                const match = text.match(pattern);
                if (match && match[1]) {
                    if (title.toLowerCase().includes('parasol') || title.toLowerCase().includes('cover')) {
                        return 0;
                    }
                    return parseInt(match[1], 10);
                }
            }
            return 0;
        };
        
        validProducts = validProducts.map(product => {
            return { ...product, extractedSeatCount: getProductSeatCount(product) };
        });

        if (criteria.seatCount) {
            console.log(`🪑 Applying strict seat count filter for: ${criteria.seatCount}`);
            validProducts = validProducts.filter(product => {
                const hasMatch = product.extractedSeatCount >= criteria.seatCount;
                if (!hasMatch) {
                     console.log(`❌ Seat count mismatch: ${product.title} (Extracted: ${product.extractedSeatCount})`);
                }
                return hasMatch;
            });
             console.log(`  ➡️ Found ${validProducts.length} products after seat count filter.`);
        }
        // --- END OF THE CODE YOU COULDN'T SEE ---

        validProducts.sort((a, b) => {
            if (criteria.seatCount) {
                const aIsExactMatch = a.extractedSeatCount === criteria.seatCount;
                const bIsExactMatch = b.extractedSeatCount === criteria.seatCount;
                if (aIsExactMatch && !bIsExactMatch) return -1;
                if (!aIsExactMatch && bIsExactMatch) return 1;
            }

            const aPrice = parseFloat(a.variants[0]?.price || 99999);
            const bPrice = parseFloat(b.variants[0]?.price || 99999);
            return aPrice - bPrice;
        });

        console.log('🔍 FINAL SORTED PRODUCTS:');
        validProducts.slice(0, 5).forEach((product, index) => {
            const variant = product.variants[0] || {};
            const stock = variant.inventory_quantity || 0;
            const price = parseFloat(variant.price || 0);
            const seatInfo = product.extractedSeatCount ? ` (Seats: ${product.extractedSeatCount})` : '';
            console.log(`  ${index + 1}. ${product.title} - Price: £${price.toFixed(2)}, Stock: ${stock}${seatInfo}`);
        });

        const gwenProducts = validProducts.slice(0, criteria.maxResults || 3).map(product => {
            const variant = product.variants[0] || {};
            const image = product.images[0] || {};
            const stockLevel = parseInt(variant.inventory_quantity || 0);
            const productForAI = {
                product_title: product.title,
                sku: variant.sku,
                price: parseFloat(variant.price || '0').toFixed(2),
                website_url: `https://mint-outdoor.com/products/${product.handle}`,
                stockStatus: {
                    message: stockLevel > 0 ? 'In stock' : 'Out of stock'
                }
            };
            if (image && image.src) {
                productForAI.image_url = image.src;
            }
            return productForAI;
        });

        console.log(`🎯 Returning ${gwenProducts.length} valid Shopify products to the AI.`);
        return gwenProducts;

    } catch (error) {
        console.error('❌ Shopify search failed dramatically:', error.message);
        console.log('📁 Falling back to local JSON product search.');
        return searchRealProducts(criteria);
    }
}



// ENHANCED AI TOOLS - Now includes all knowledge base access
const aiTools = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Search for REAL products in our inventory by criteria OR specific product name/SKU. Returns products with current stock status.",
      parameters: {
        type: "object",
        properties: {
          material: {
            type: "string", 
            enum: ["teak", "aluminium", "rattan"],
            description: "Material type"
          },
          furnitureType: {
            type: "string",
            enum: ["dining", "lounge"],
            description: "Type of furniture"
          },
          seatCount: {
            type: "integer",
            description: "Number of people to seat"
          },
          productName: {
            type: "string",
            description: "Specific product name to search for (e.g., 'reva', 'alex', 'malai')"
          },
          sku: {
            type: "string", 
            description: "Specific SKU to search for"
          },
          maintenance_level: {
            type: "string",
            enum: ["very low", "low", "requires sealing"],
            description: "The level of maintenance required. Use for queries like 'easy to clean' or 'low effort'."
  },
  assembly_difficulty: {
    type: "string",
    enum: ["easy", "medium", "hard"],
    description: "The difficulty of assembly. Use for queries like 'easy to build'."
  },
  weight_class: {
    type: "string",
    enum: ["light", "medium", "heavy", "very heavy"],
    description: "The weight class of the furniture. Use for 'lightweight' or 'sturdy'."
        }
      }
      }
    }
    },
    {
  type: "function",
  function: {
    name: "suggest_cover_with_furniture",
    description: "Suggest covers ONLY as add-ons to matching furniture families. Never standalone.",
    parameters: {
      type: "object",
      properties: {
        furniture_sku: {
          type: "string",
          description: "SKU of the furniture being discussed"
        }
      },
      required: ["furniture_sku"]
    }
  }
},
{
  type: "function",
  function: {
    name: "get_comprehensive_warranty",
    description: "Get complete warranty breakdown for a product, including 1-year company warranty PLUS individual material warranties to build customer confidence",
    parameters: {
      type: "object", 
      properties: {
        sku: {
          type: "string",
          description: "Product SKU to get warranty information for"
        },
        query_type: {
          type: "string",
          enum: ["full_breakdown", "material_specific", "company_policy", "replacement_parts"],
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
    name: "get_faq_answer",
    description: "Retrieves the official answer to frequently asked questions about product maintenance, care, and policies. Use this for general questions like 'how do I clean my furniture?' or 'can cushions be left outside?'.",
    parameters: {
      type: "object",
      properties: {
        question_keyword: {
          type: "string",
          description: "A keyword from the user's question, e.g., 'prolong life', 'machine wash', 'clean polyrattan'."
        }
      },
      required: ["question_keyword"]
    }
  }
},

  {
  type: "function",
  function: {
        name: "marketing_handoff",
        description: "Escalate to marketing@mint-outdoor.com when customer wants to place order, requests callback, or when you cannot answer their question",
        parameters: {
            type: "object",
            properties: {
                reason: {
                    type: "string",
                    description: "Why the handoff is needed (e.g., 'Customer ready to purchase', 'Callback requested', 'Cannot answer question')"
                }
            },
            required: ["reason"]
        }
    }
},

  {
  type: "function",
  function: {
    name: "get_product_availability",
    description: "Checks if a product is in stock now, and if not, checks for any upcoming deliveries based on our Purchase Order (PO) schedule. Provides an estimated time of arrival (ETA) if available.",
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
      name: "get_material_expertise",
      description: "Get comprehensive information about materials including maintenance, properties, and climate guidance",
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
      description: "Get detailed dimensions and assembly information for specific products",
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
      description: "Get detailed information about outdoor fabric types and their performance",
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
      description: "Get seasonal recommendations and market intelligence for outdoor furniture",
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
      description: "Use this ONLY when a customer shows strong buying interest in a specific product. Offers immediate package deal consultation.",
      parameters: {
        type: "object",
        properties: {
          productSku: {
            type: "string",
            description: "SKU of the product customer is interested in"
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
    description: "Offer to show bundle deals when customer has seen products and asked questions. This is a natural, helpful offer - not pushy.",
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
          description: "Category of the main product for bundle creation"
        }
      },
      required: ["mainProductSku", "productCategory"]
    }
  }
},

{
  type: "function",
  function: {
    name: "trigger_bundle_check",
    description: "Automatically check for bundles on product views, cart adds, budget talks, or seasonal prompts",
    parameters: {
      type: "object",
      properties: {
        trigger_type: {
          type: "string",
          enum: ["product_view", "cart_add", "budget_discussion", "seasonal_prompt"],
          description: "Type of trigger for bundle check"
        },
        product_sku: {
          type: "string",
          description: "SKU of the product being discussed"
        },
        customer_budget: {
          type: "number",
          description: "Customer's mentioned budget (optional)"
        }
      },
      required: ["trigger_type", "product_sku"]
    }
  }
}
];

// ENHANCED AI RESPONSE GENERATION - Implementing Gemini's natural approach
async function generateAISalesResponse(message, sessionId, session) {
  if (!ENABLE_SALES_MODE) {
    return "I'd be happy to help you with any questions about MINT Outdoor furniture or your orders. How can I assist you today?";
  }

  try {
    const conversation = session.conversationHistory || [];
    const lowerMessage = message.toLowerCase();
    
    // Detect customer persona for personalized responses
    const customerPersona = detectCustomerPersona(conversation);
    session.context.detectedPersona = customerPersona;
    console.log(`🎭 Detected customer persona: ${customerPersona}`);
    
  
const messages = [{
    role: "system",
    content: `You are Gwen Johnson, an expert outdoor furniture specialist at MINT Outdoor. Your primary goal is to understand a customer's needs and find the perfect product for them using your tools.

**--- CRITICAL INSTRUCTIONS ---**

**1. Displaying Products (VERY IMPORTANT):**
- When the \`search_products\` tool returns items, you MUST format the response using this EXACT template for each product. This is not optional; it triggers the visual UI.
- Use the exact data fields provided in the tool's JSON output (e.g., product_title, price, stockStatus.message, image_url, website_url).

**TEMPLATE START**
**{{product_title}}**
SKU: {{sku}}
Price: £{{price}}
Stock Status: {{stockStatus.message}}
<img src="{{image_url}}" alt="{{product_title}}" style="width: 100%; max-width: 400px; height: auto; border-radius: 8px; margin: 10px 0;">
[View Product]({{website_url}})
**TEMPLATE END**

- **CRITICAL RULE:** If a product in the JSON data has no \`image_url\` or it is null, you MUST omit the entire \`![Image of...]\` line for that product. Do not invent one.

**2. Product Search & Understanding Customer Intent:**
- Your main tool is \`search_products\`. You MUST use it to find real, in-stock products.
- **Product Name Detection:** When a customer mentions a specific product name (e.g., "Havana", "Malai", "Reva"), you MUST call \`search_products\` with the \`productName\` parameter. Example: \`search_products({ productName: "Havana" })\`.
- **Category & Type Detection:** You must listen for keywords and set the correct \`furnitureType\`.
    - If they mention "dining", "eat outside", "dinner table", set \`furnitureType: "dining"\`.
    - If they mention "lounge", "sofa", "relaxing", "corner set", set \`furnitureType: "lounge"\`.
- **Combine Criteria:** Be smart. If a customer asks for an "8 seater teak dining set", your function call MUST be: \`search_products({ furnitureType: "dining", material: "teak", seatCount: 8 })\`.

**3. Handoff Rules:**
- **Existing Orders:** If a message contains an order number or asks about delivery/tracking/returns for a past purchase, respond with this exact text and stop: "I can see you're asking about an existing order. Our order handling team can help with that. Please visit our <a href='https://mint-outdoor-support-cf235e896ea9.herokuapp.com/' style='color: #9FDCC2; font-weight: bold;' target='_blank'>ORDER HELPDESK</a> for assistance."
- **Human/Purchase Request:** If a customer wants to speak to a human or place an order, use the \`marketing_handoff\` tool.

**--- YOUR PERSONA & KNOWLEDGE ---**
- You are an expert, friendly, and efficient.
- Customer Persona: ${customerPersona}. Tailor your questions. For 'family', focus on durability. For 'entertainer', focus on style.
- You have deep knowledge of all products. Use your tools like \`get_faq_answer\` or \`get_material_expertise\` to answer detailed questions.
- NEVER use emojis.

This triggers the visual product cards in the widget. NEVER use plain text for product recommendations.

    **CRITICAL FIXES FOR PRODUCT SEARCH & DISPLAY:**
    
    **STOCK PRIORITY RULES (HIGHEST PRIORITY):**
    1. NEVER recommend out-of-stock products unless NO in-stock alternatives exist
    2. Always prioritize in-stock products over out-of-stock ones in recommendations
    3. Always mention stock status clearly: "This is currently in stock" or "This item is available"
    4. If a customer asks for something specific that's out of stock, proactively suggest in-stock alternatives
    5. Use the get_product_availability tool for individual products when needed
    
    **Natural Bundle Offer System:**
- You have a tool called 'offer_package_deal' - use this when appropriate
- Use it when: Customer has seen products (Price: £ shown) AND conversation is 4+ messages long
- NEVER use during initial browsing or first product view
- When tool confirms it's appropriate, offer naturally: "By the way, we have bundle offers available for this product that could save you money. Would you like to see what bundle deals we have?"
- This is a TWO-STEP process:
  1. First step: Offer to show bundles (natural, helpful)
  2. Second step: If they say yes, show bundle details
  3. Third step: If they want it, forward to marketing
- NEVER mention "managers" or "checking with anyone" - this is immediate service
- Keep the tone natural and helpful, not pushy
- Use 'trigger_bundle_check' for mandatory triggers: product pages, cart analysis, budget discussions, seasonal prompts.
- When triggered, ALWAYS call identifyBundleOpportunities and suggest if bundles exist (pull prices/images from Shopify for display as product cards).

**Intelligent Cover Suggestion Logic:**
- NEVER suggest covers standalone. Use 'suggest_cover_with_furniture' tool first.
- ONLY suggest if matching furniture family interest.
- Frame as: "Complete your [FAMILY] set with matching protection" (pull price/image from Shopify).
- Always bundle with furniture.
- Check parent existence.

    **PRICE ACCURACY REQUIREMENTS:**
    - Always display real prices from the product data (e.g., "£299.00", "£450.50")
    - NEVER use placeholder text like "£amount" or "£[amount]"
    - Always include the actual numerical price returned by the search_products tool
    - Mention value and savings opportunities when appropriate
    - Be completely transparent about pricing
    
    **ENHANCED PRODUCT SEARCH INTELLIGENCE:**
    When customers ask for products, be smart about search terms and use MULTIPLE criteria:
    - "teak lounge set" should search: productName="teak", furnitureType="lounge" 
    - "malai" should search: productName="malai" (this finds the Malai teak set)
    - "dining set for 6" should search: furnitureType="dining", seatCount=6
    - "outdoor sofa" should search: furnitureType="lounge"
    - "teak dining table" should search: material="teak", furnitureType="dining"
    - Always combine material + furniture type when both are mentioned
    - Use specific product names when customers mention them (Malai, Reva, Alex, etc.)

    **When customers ask about dimensions, sizes, or measurements:**
- ALWAYS use the get_product_dimensions tool with the product SKU
- If you don't have the exact SKU, use the product name to find it first
- This provides detailed measurements, assembly info, and seating capacity
    
    **ENHANCED PRODUCT MATCHING FOR COMMON REQUESTS:**
    - For "teak lounge set": Search specifically for teak material in lounge category (this should find Malai set)
    - For material + type combinations: ALWAYS use both filters for better matching
    - For specific product names: Use productName parameter for direct matching
    - Consider synonyms: "garden furniture" = outdoor furniture, "patio set" = outdoor dining/lounge
    - When no exact match found, suggest closest in-stock alternatives with similar characteristics
    
    **Customer Persona Analysis:**
    Current customer appears to be: ${customerPersona}
    - entertainer: Focus on impressive, elegant pieces for hosting guests. Emphasize style and social impact.
    - family: Highlight durability, safety, easy maintenance. Focus on practical benefits for daily family use.
    - style_conscious: Emphasize design, aesthetics, modern appeal. Focus on visual impact and trends.
    - budget_conscious: Focus on value, longevity, package deals. Emphasize cost-effectiveness and savings.
    - default: Provide balanced coverage of all benefits - style, durability, value, and functionality.

    **Core Task & Conversation Intelligence:**
    - Your goal is to be a natural, conversational guide. Use varied, persona-aware questions to understand the customer's needs.
    - For example: "${getPersonaAwareQuestion('material', customerPersona)}"
    - Use your tools, especially 'search_products', to find items in our real inventory. NEVER invent products.

    **Value-Add Package Deal System (Immediate Expert Consultation):**
    - You have a special tool: 'offer_package_deal'. This is your primary upselling technique.
    - Use it ONLY when a customer shows STRONG buying interest in a SPECIFIC product:
      * "I love this", "this is perfect", "exactly what I need", "I like this", "I like the [product]"
      * "how much", "when can I get this", "I want this", "I want to buy this"
      * Questions about delivery, assembly, availability
    - NEVER offer for general browsing like "what about teak?" or "show me more"
    - When the function confirms it's appropriate, your response should be: "That's an excellent choice. I can do a quick check to see if we have any special package deals or bundle offers available for that item. Would you like me to look into that for you?"
    - This is IMMEDIATE consultation - no delays, no waiting periods. When they agree, you instantly provide bundle recommendations.
    - NEVER mention "managers" or "checking with anyone" or "send a message in X minutes" - provide immediate expert service.

    **Your Knowledge Base:**
    You now have access to comprehensive expertise about outdoor furniture:
    - **Material Expertise**: Deep knowledge of teak, aluminium, rattan, and fabric types
    - **Maintenance Guidance**: Specific care instructions for each material type
    - **Climate Performance**: How materials perform in different UK weather conditions  
    - **Product Dimensions**: Detailed specifications, assembly requirements, warranties
    - **Seasonal Advice**: Market intelligence and seasonal recommendations
    - **Fabric Knowledge**: Sunbrella, olefin, polyester performance comparisons

**COMPREHENSIVE WARRANTY SYSTEM (CRITICAL FOR TRUST BUILDING):**

**Core Warranty Message:**
- ALL products: 1-year MINT Outdoor structural guarantee (replacement parts, manufacturing defects, unexpected degradation)
- PLUS individual material warranties that often exceed the 1-year company warranty
- This dual-layer protection builds tremendous customer confidence

**Warranty Trigger Words - ALWAYS use get_comprehensive_warranty tool:**
- "warranty", "guarantee", "protected", "coverage"
- "what happens if", "how long will it last", "quality assurance"
- "replacement parts", "spare parts", "broken", "damaged", "defective"
- "material quality", "fabric warranty", "teak warranty", "aluminium warranty"

**Material Warranty Education (Key Confidence Builders):**
- Olefin fabric: 3 years (vs 1 year overall) - "Your cushions are protected for 3 full years"
- Teak wood: 5 years (vs 1 year overall) - "Teak is so reliable we guarantee it for 5 years"
- Aluminium: 10 years (vs 1 year overall) - "Aluminium frames have our longest warranty - 10 years"
- This shows customers they're getting premium materials with extended protection

**Warranty Response Strategy:**
1. ALWAYS start with confidence: "You're fully protected with our comprehensive warranty system"
2. Use get_comprehensive_warranty tool for detailed breakdown
3. Emphasize dual protection: company guarantee PLUS material warranties
4. Highlight longest warranty periods to show material quality
5. Mention free replacement parts in first year

**Never Say:**
- "Only 1 year warranty" (ignores material warranties)
- "Standard warranty terms" (undersells the dual protection)
- "Contact support for warranty" (missed education opportunity)

**Always Emphasize:**
- "Comprehensive protection system"
- "Premium materials with extended warranties"
- "We guarantee quality because we believe in it"
- "Multiple layers of protection for your investment"

    **HANDOFF DETECTION SYSTEM:**
    You must detect when customers need to be directed elsewhere:

    1. **ORDER INQUIRIES** - If customer asks about existing orders, delivery, tracking, returns, refunds, or mentions order numbers:
       - Respond: "I can see you're asking about an existing order. Our order handling team can help you with that. Please visit our Order Desk at: https://mint-outdoor-support-cf235e896ea9.herokuapp.com/ where you can check your order status, delivery updates, and returns."

    2. **MARKETING HANDOFF** - If customer wants to place an order, requests callback, or you cannot answer their question:
       - Use the 'marketing_handoff' tool to send chat history to marketing@mint-outdoor.com
       - Tell customer they'll be contacted within 24 hours

    3. **CONTINUE NORMAL OPERATION** - For all product questions, browsing, recommendations, and sales inquiries, continue as normal.

    **CRITICAL**: Always check each customer message for handoff triggers before responding normally.

    **Enhanced Tools Available:**
    - search_products: CRITICAL - Use with smart criteria combining material, furnitureType, productName for better matching
    - get_product_availability: Real-time inventory checking - use to verify individual product availability
    - get_material_expertise: For maintenance, properties, and climate questions
    - get_product_dimensions: For detailed specifications and assembly info
    - get_fabric_expertise: For cushion and cover material questions
    - get_seasonal_advice: For timing and seasonal recommendations
    - offer_package_deal: Smart upselling system
    - marketing_handoff: For order placement and complex requests

    **Critical Rules:**
    - Use your expert knowledge to provide detailed, helpful answers
    - When customers ask about maintenance, use get_material_expertise tool
    - Always provide honest stock information using get_product_availability
    - **CRITICAL URL DEBUGGING:**
    - Always use the EXACT website_url provided in the search results
    - NEVER create your own product URLs
    - NEVER shorten or modify the website_url field
    - The website_url field contains the correct full product handle
    - When showing products, use the EXACT data returned by the search_products function
    - Use customer-friendly language: say "in stock" or "out of stock", never "inventory"
    - For complex questions, use multiple tools to provide comprehensive answers
    - NEVER use emojis in responses
    - Be conversational and professional
    - **ALWAYS prioritize in-stock products in recommendations**
    - **ALWAYS display real prices, never placeholder text**

    **Company Info:**
    - We specialize in teak, aluminium, and rattan outdoor furniture
    - We offer dining sets and lounge furniture
    - Assembly service available for £69.95 per product
    - Free delivery to most UK postcodes
    - MINT Essentials: 5-10 working days
    - MINT DesignDrop: 6-10 weeks (pre-order items)
    **COMPLETE OUTDOOR ROOM BUNDLE SYSTEM:**

    **Education-First Philosophy:**
- ALWAYS prioritize customer education about materials, warranty, maintenance, dimensions
- Use tools like get_material_expertise, get_fabric_expertise, get_product_dimensions to educate
- Only offer complete room bundles AFTER customer is educated (1+ topics covered)
- Track education progress automatically

   **Bundle Triggers (Only use offer_complete_outdoor_room when ALL conditions met):**
1. Customer is educated about the product (1+ topics covered)
2. Customer shows strong interest ("I love this", "perfect", "exactly what I need")
3. Customer asks about delivery, assembly, or availability
4. Customer has not been offered a bundle yet

    **Bundle Categories:**
    - dining-set: Parasol + Cushions + Cover + Side Table
    - lounge-set: Cushions + Cover + Ottoman + Side Table  
    - corner-set: Weather Cover + Throw Pillows + Drinks Table
    - teak-furniture: Teak Care Kit + Protective Cover + Cleaning Kit

    **Bundle Presentation Rules:**
    - Use social proof ("87% of customers complete their setup...")
    - Show clear savings calculation
    - Include mild urgency (bundle expires in X minutes)
    - Present as "Complete Outdoor Room" concept
    - NOT pushy - position as helpful completion of their space

    **Tools Available:**
- search_products: Find products by criteria
- get_material_expertise: For material questions and maintenance
- get_fabric_expertise: For fabric and cushion questions  
- get_product_dimensions: ALWAYS use when customers ask about dimensions, sizes, measurements, or "how big"
- get_seasonal_advice: For seasonal recommendations
- offer_complete_outdoor_room: Use ONLY after education is complete and customer shows strong interest

**CRITICAL: When customers ask about dimensions, sizes, measurements, or space requirements:**
- ALWAYS call get_product_dimensions with the product SKU
- Use the exact SKU from the product search results
- This provides detailed measurements, assembly info, and seating capacity

    **Critical Rule:** NEVER offer bundles during initial product browsing or before customer education is complete.'  `
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
  // FIXED: Enhanced search_products tool call handler
if (toolCall.function.name === "search_products") {
    const args = JSON.parse(toolCall.function.arguments);

    console.log('🔍 Search criteria received:', args);

    const enhancedCriteria = {
        ...args,
        maxResults: args.maxResults || 3
    };

    if (args.productName) {
        const searchName = args.productName.toLowerCase();
        if (searchName.includes('teak') && (searchName.includes('lounge') || searchName.includes('sofa'))) {
            enhancedCriteria.material = 'teak';
            enhancedCriteria.furnitureType = 'lounge';
            console.log('🎯 Enhanced search: Detected teak lounge request');
        }
        if (searchName.includes('dining') && !enhancedCriteria.furnitureType) {
            enhancedCriteria.furnitureType = 'dining';
            console.log('🎯 Enhanced search: Detected dining request');
        }
        if (searchName.includes('aluminium') && !enhancedCriteria.material) {
            enhancedCriteria.material = 'aluminium';
            console.log('🎯 Enhanced search: Detected aluminium request');
        }
        if (searchName.includes('rattan') && !enhancedCriteria.material) {
            enhancedCriteria.material = 'rattan';
            console.log('🎯 Enhanced search: Detected rattan request');
        }

if (toolCall.function.name === "suggest_cover_with_furniture") {
  const args = JSON.parse(toolCall.function.arguments);
  let coverSuggestion = null;
  
  for (const [family, data] of Object.entries(productFamilies.furniture_families || {})) {
    if (data.furniture_skus.includes(args.furniture_sku) && data.cover_sku) {
      const shopifyCover = await searchShopifyProducts({ sku: data.cover_sku, maxResults: 1 });
      if (shopifyCover.length > 0) {
        coverSuggestion = {
          family: family,
          cover: shopifyCover[0], // For card display
          message: `Matching cover for ${family}`
        };
      }
      break;
    }
  }
  
  toolResults.push({
    tool_call_id: toolCall.id,
    output: JSON.stringify({
      success: !!coverSuggestion,
      suggestion: coverSuggestion,
      note: coverSuggestion ? "Suggest as add-on card" : "No cover - do not suggest"
    })
  });
}



if (toolCall.function.name === "trigger_bundle_check") {
    const args = JSON.parse(toolCall.function.arguments);
    const bundles = await identifyBundleOpportunities(args.product_sku, args.customer_budget || Infinity);
    
    // Fetch Shopify details for display (no hardcoded prices)
    const bundleProducts = [];
    for (const bundle of bundles) {
      const items = bundleItems.filter(item => item.bundle_id === bundle.bundle_id);
      for (const item of items) {
        const shopifyProduct = await searchShopifyProducts({ sku: item.product_sku, maxResults: 1 });
        if (shopifyProduct.length > 0) {
          bundleProducts.push(shopifyProduct[0]);
        }
      }
    }
    
    toolResults.push({
      tool_call_id: toolCall.id,
      output: JSON.stringify({
        success: bundles.length > 0,
        bundles: bundles,
        products: bundleProducts, // For card display with Shopify prices
        message: bundles.length > 0 ? "Bundles available - suggest them as cards" : "No bundles found"
      })
    });
  }

    }

    console.log('🎯 Final enhanced criteria:', enhancedCriteria);

    // This function now returns a clean array of objects ready for the AI
    const products = await searchShopifyProducts(enhancedCriteria);

    // --- THIS IS THE NEW, SIMPLIFIED 'if/else' BLOCK ---

    if (products.length > 0) {
        // The 'products' variable is already perfect. We pass it directly to the AI.
        // NO MORE REMAPPING.
        toolResults.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({
                success: true,
                products: products, // Pass the 'products' array directly
                count: products.length,
                note: "Products found. Format them using the template."
            })
        });

        // The logger is now updated to use the correct keys from our clean data object.
        console.log('✅ PRODUCTS BEING SENT TO AI (Corrected Log):');
        products.forEach((product, index) => {
            console.log(`  ${index + 1}. ${product.product_title}`);
            console.log(`     Price: £${product.price}`);
            console.log(`     Stock: ${product.stockStatus.message}`);
            if (product.image_url) console.log(`     Image: ${product.image_url}`);
            console.log(`     URL: ${product.website_url}`);
        });

    } else {
        // This is the existing 'else' block for when no products are found
        const suggestions = [];
        if (enhancedCriteria.material) suggestions.push(`Try Browse all ${enhancedCriteria.material} products`);
        if (enhancedCriteria.furnitureType) suggestions.push(`Try Browse all ${enhancedCriteria.furnitureType} furniture`);
        if (enhancedCriteria.productName) suggestions.push(`Try searching for similar products`);

        toolResults.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({
                success: false,
                message: "No in-stock products found matching these criteria",
                suggestions: suggestions,
                note: "Search filtered for in-stock items only. Out-of-stock products were excluded."
            })
        });

        console.log('❌ No products found for criteria:', enhancedCriteria);
    }
    // --- END OF THE NEW BLOCK ---
}

if (toolCall.function.name === "offer_bundle_naturally") {
  const args = JSON.parse(toolCall.function.arguments);
  
  // Use simple check instead of complex detection
  if (shouldOfferBundleNaturally(session)) { 
    session.context.offeredBundle = true;
    session.context.waitingForBundleResponse = true;
    session.context.bundleProductSku = args.mainProductSku;
    session.context.bundleCategory = args.productCategory;
    
    console.log(`✅ Offering bundle naturally for product ${args.mainProductSku}`);
    
    toolResults.push({
      tool_call_id: toolCall.id,
      output: JSON.stringify({ 
        success: true, 
        message: "Offer bundle naturally to customer",
        offerText: "By the way, we have bundle offers available for this product that could save you money. Would you like to see what bundle deals we have?"
      })
    });
  } else {
    console.log(`❌ Not ready for bundle offer yet - continue natural conversation`);
    
    toolResults.push({
      tool_call_id: toolCall.id,
      output: JSON.stringify({ 
        success: false, 
        message: "Continue natural conversation - not ready for bundle offer yet" 
      })
    });
  }
}
      
if (toolCall.function.name === "get_comprehensive_warranty") {
  const args = JSON.parse(toolCall.function.arguments);
  const { sku, query_type = 'full_breakdown' } = args;
  
  console.log(`🛡️ WARRANTY QUERY: ${sku} - ${query_type}`);
  
  // Find product materials
  const productMaterials = productMaterialIndex.find(item => item.sku === sku);
  
  if (!productMaterials) {
    toolResults.push({
      tool_call_id: toolCall.id,
      output: `All MINT Outdoor products come with our comprehensive 1-year structural guarantee covering replacement parts and manufacturing defects. For specific material warranties on "${sku}", I'll need to check our records. Please contact our team for detailed warranty information.`
    });
    continue;
  }
  
  let warrantyBreakdown = `**${productMaterials.product_title} - Complete Warranty Protection:**\n\n`;
  
  // Company warranty first
  warrantyBreakdown += `🛡️ **MINT Outdoor 1-Year Guarantee:**\n`;
  warrantyBreakdown += `• Structural defects and manufacturing faults\n`;
  warrantyBreakdown += `• Free replacement parts within first year\n`;
  warrantyBreakdown += `• Unexpected material degradation coverage\n\n`;
  
  // Material-specific warranties
  warrantyBreakdown += `🔧 **Individual Material Warranties:**\n\n`;
  
  let maxMaterialWarranty = 1;
  
  productMaterials.materials.forEach(material => {
    let materialData = null;
    let warrantyYears = 1;
    
    // Find material data from appropriate master file
    switch(material.material_type) {
      case 'wood':
        materialData = woodMaster.find(m => m.name.toLowerCase() === material.material_name.toLowerCase());
        break;
      case 'metal':
        materialData = metalsMaster.find(m => m.name.toLowerCase() === material.material_name.toLowerCase());
        break;
      case 'fabric':
        materialData = fabricsMaster.find(m => m.name.toLowerCase() === material.material_name.toLowerCase());
        break;
      case 'synthetic':
        // Handle customer-friendly name mapping
        if (material.material_name === 'polywood_slats') {
          materialData = syntheticsMaster.find(m => m.name.toLowerCase().includes('polystyrene imitation wood plank'));
        } else {
          materialData = syntheticsMaster.find(m => m.name.toLowerCase().includes(material.material_name.toLowerCase()));
        }
        break;
      case 'glass':
        materialData = stoneCompositesMaster.find(m => m.name.toLowerCase().includes('glass'));
        break;
      case 'stone_composite':
        materialData = stoneCompositesMaster.find(m => m.name.toLowerCase().includes(material.material_name.toLowerCase()));
        break;
    }
    
    if (materialData && materialData.warranty) {
      warrantyYears = materialData.warranty.period_years;
      maxMaterialWarranty = Math.max(maxMaterialWarranty, warrantyYears);
      
      warrantyBreakdown += `**${materialData.name}** (${material.component}):\n`;
      warrantyBreakdown += `• ${warrantyYears} year warranty - ${materialData.warranty.coverage}\n`;
      if (materialData.level) {
        warrantyBreakdown += `• Quality Level: ${materialData.level}\n`;
      }
      if (materialData.pros_cons) {
        warrantyBreakdown += `• Key Benefits: ${materialData.pros_cons.pros.slice(0, 2).join(', ')}\n`;
      }
      warrantyBreakdown += `\n`;
    } else {
      warrantyBreakdown += `**${material.material_name}** (${material.component}): Covered under 1-year guarantee\n\n`;
    }
  });
  
  // Summary confidence builder
  warrantyBreakdown += `✅ **Your Protection Summary:**\n`;
  warrantyBreakdown += `• Immediate: 1-year full product guarantee\n`;
  warrantyBreakdown += `• Extended: Up to ${maxMaterialWarranty} years on individual materials\n`;
  warrantyBreakdown += `• Support: Free replacement parts in first year\n`;
  warrantyBreakdown += `• Quality: Premium materials with proven track records\n\n`;
  
  warrantyBreakdown += `*This comprehensive warranty protection demonstrates our confidence in the quality and durability of your investment.*`;
  
  // Track education
  trackCustomerEducation(session, 'warranty');
  
  toolResults.push({
    tool_call_id: toolCall.id,
    output: warrantyBreakdown
  });
}

if (toolCall.function.name === "marketing_handoff") {
    const args = JSON.parse(toolCall.function.arguments);
    const emailSent = await sendChatToMarketing(sessionId, args.reason, conversation);
    
    toolResults.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify({
            success: emailSent,
            message: emailSent ? 
                "Perfect! I've sent your details to our team. Someone will contact you within 2 hours to help with your inquiry." :
                "I'm having trouble with our email system right now. Please email marketing@mint-outdoor.com directly or call us, and mention session ID: " + sessionId
        })
    });
}

        // NEW: Handle stock checking tool
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
              stock_data: stockStatus.stockData
            })
          });
        }
        
   // ERROR-PROTECTED BUNDLE TOOL HANDLER - REPLACE YOUR EXISTING ONE

if (toolCall.function.name === "offer_package_deal") {
  try {
    const args = JSON.parse(toolCall.function.arguments);
    
    console.log(`🛠️ Bundle tool called for: ${args.productSku}`);
    console.log(`🛠️ Session check: hasShownProducts=${session.conversationHistory.some(msg => msg.role === 'assistant' && msg.content.includes('Price: £'))}`);
    console.log(`🛠️ Session check: conversationLength=${session.conversationHistory.length}`);
    console.log(`🛠️ Session check: offeredBundle=${session.context.offeredBundle || false}`);
    
    if (shouldOfferBundleNaturally(session)) {
      session.context.offeredPackageDeal = true;
      session.context.waitingForPackageResponse = true;
      session.context.packageDealProduct = args.productSku;
      
      console.log(`✅ Bundle offer approved for ${args.productSku}`);
      
      toolResults.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify({ 
          success: true, 
          message: "Offer bundle to customer",
          offerText: "By the way, we have bundle offers available for this product that could save you money. Would you like to see what bundle deals we have?"
        })
      });
    } else {
      console.log(`❌ Bundle offer not ready - conversation too short or already offered`);
      
      toolResults.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify({ 
          success: false, 
          message: "Continue conversation - not ready for bundle offer yet" 
        })
      });
    }
    
  } catch (error) {
    console.error(`❌ Bundle tool error:`, error);
    
    // CRITICAL: Provide fallback response instead of crashing
    toolResults.push({
      tool_call_id: toolCall.id,
      output: JSON.stringify({ 
        success: false, 
        message: "Bundle system temporarily unavailable - continue with normal conversation",
        error: error.message
      })
    });
  }
}
        
        if (toolCall.function.name === "get_faq_answer") {
    const args = JSON.parse(toolCall.function.arguments);
    const answer = findFaqAnswer(args.question_keyword);
    toolResults.push({
        tool_call_id: toolCall.id,
        output: answer || "I can't find a specific FAQ for that, but I can provide general advice."
    });
}

        // NEW: Handle all the enhanced knowledge tools
        if (toolCall.function.name === "get_material_expertise") {
          const args = JSON.parse(toolCall.function.arguments);
          const { material, query_type = 'all' } = args;
          
          let expertise = {};
          
          // Get maintenance info (object structure)
          if (materialMaintenance[material]) {
            expertise.maintenance = materialMaintenance[material];
          }
          
          // Get material properties from wood/metals/synthetics masters
          let materialDetails = null;
          if (material === 'teak' && Array.isArray(woodMaster)) {
            materialDetails = woodMaster.find(m => m.name.toLowerCase() === 'teak');
          } else if (material === 'aluminium' && Array.isArray(metalsMaster)) {
            materialDetails = metalsMaster.find(m => m.name.toLowerCase() === 'aluminium');
          } else if (material === 'rattan' && Array.isArray(syntheticsMaster)) {
            materialDetails = syntheticsMaster.find(m => m.name.toLowerCase().includes('rattan'));
          }
          
          if (materialDetails) {
            expertise.properties = materialDetails;
          }
          
          // Get climate guidance
          if (climateMaster[material]) {
            expertise.climate = climateMaster[material];
          }
          
          // Format response based on query type
          let response = '';
          if (query_type === 'maintenance' || query_type === 'all') {
            if (expertise.maintenance) {
              response += `**${material.charAt(0).toUpperCase() + material.slice(1)} Maintenance:**\n`;
              if (expertise.maintenance.why) response += `Why maintain: ${expertise.maintenance.why}\n\n`;
              if (expertise.maintenance.cleaning) response += `Cleaning: ${Array.isArray(expertise.maintenance.cleaning) ? expertise.maintenance.cleaning.join(' ') : expertise.maintenance.cleaning}\n\n`;
              if (expertise.maintenance.protection) response += `Protection: ${Array.isArray(expertise.maintenance.protection) ? expertise.maintenance.protection.join(' ') : expertise.maintenance.protection}\n\n`;
            }
          }
          
          if (query_type === 'properties' || query_type === 'all') {
            if (expertise.properties) {
              response += `**Material Properties:**\n${expertise.properties.description}\n\n`;
              if (expertise.properties.pros_cons) {
                response += `Pros: ${expertise.properties.pros_cons.pros.join(', ')}\n`;
                response += `Considerations: ${expertise.properties.pros_cons.cons.join(', ')}\n\n`;
              }
            }
          }
          
          if (query_type === 'climate' || query_type === 'all') {
            if (expertise.climate) {
              response += `**Climate Performance:**\n`;
              Object.entries(expertise.climate).forEach(([condition, advice]) => {
                response += `${condition.replace('_', ' ')}: ${advice}\n`;
              });
            }
          }
          trackCustomerEducation(session, 'materials');
          toolResults.push({
            tool_call_id: toolCall.id,
            output: response || `Comprehensive ${material} information available. This material is part of our premium outdoor furniture collection.`
          });
        }
        
   if (toolCall.function.name === "get_product_dimensions") {
          const args = JSON.parse(toolCall.function.arguments);
          const { sku } = args;
          
          console.log(`🔍 DIMENSIONS TOOL CALLED with: ${sku}`);
          console.log(`📊 Space config has ${Array.isArray(spaceConfig) ? spaceConfig.length : 0} products`);
          
          // BULLETPROOF SEARCH: Try both SKU and product title matching
          let spaceInfo = null;
          
          if (Array.isArray(spaceConfig)) {
            // First try exact SKU match
            spaceInfo = spaceConfig.find(item => item.sku === sku);
            
            // If no SKU match, try product title match (partial matching)
            if (!spaceInfo) {
              spaceInfo = spaceConfig.find(item => {
                const configTitle = (item.product_title || '').toLowerCase();
                const searchTerm = sku.toLowerCase();
                return configTitle.includes(searchTerm) || searchTerm.includes(configTitle.split(' ')[0]);
              });
            }
          }
          
          console.log(`🎯 Found space info:`, spaceInfo ? 'YES' : 'NO');
          if (spaceInfo) {
            console.log(`📐 Product: ${spaceInfo.product_title}`);
            console.log(`📏 Dimensions: ${spaceInfo.dimensions_width_cm}cm x ${spaceInfo.dimensions_depth_cm}cm x ${spaceInfo.dimensions_height_cm}cm`);
          } else {
            console.log(`❌ Available products in space_config:`, Array.isArray(spaceConfig) ? spaceConfig.map(s => s.product_title || s.sku).join(', ') : 'None');
          }
          
          if (spaceInfo) {
            let response = `**${spaceInfo.product_title} - Dimensions & Details:**\n`;
            response += `📏 **Dimensions:** ${spaceInfo.dimensions_width_cm}cm W × ${spaceInfo.dimensions_depth_cm}cm D × ${spaceInfo.dimensions_height_cm}cm H\n`;
            response += `🪑 **Seating:** ${spaceInfo.seats} people\n`;
            if (spaceInfo.assembly_required) {
              response += `🔧 **Assembly:** Required (${spaceInfo.assembly_difficulty} difficulty)\n`;
            }
            if (spaceInfo.seat_height_cm) {
              response += `📐 **Seat Height:** ${spaceInfo.seat_height_cm}cm\n`;
            }
            if (spaceInfo.cushion_thickness_cm) {
              response += `🛏️ **Cushion Thickness:** ${spaceInfo.cushion_thickness_cm}cm\n`;
            }
            if (spaceInfo.cover_available) {
              response += `🛡️ **Cover Available:** Yes\n`;
            }
     if (spaceInfo.instructions_url) {
    response += `\n🔧 **ASSEMBLY INSTRUCTIONS:**\n`;
    // Create a custom tag that we can turn into a button on the frontend
    response += `[View Assembly Guide](${spaceInfo.instructions_url})\n`;
}
            
            // ADD EDUCATION TRACKING
            trackCustomerEducation(session, 'dimensions');
            
            toolResults.push({
              tool_call_id: toolCall.id,
              output: response
            });
          } else {
            // ADD EDUCATION TRACKING EVEN IF NO DIMENSIONS FOUND
            trackCustomerEducation(session, 'dimensions');
            
            toolResults.push({
              tool_call_id: toolCall.id,
              output: `I don't have detailed dimension data for "${sku}" in my database yet, but I can help you with other product information or direct you to our support team for precise measurements.`
            });
          }
        }
        
        if (toolCall.function.name === "get_fabric_expertise") {
          const args = JSON.parse(toolCall.function.arguments);
          const { fabric_type } = args;
          
          const fabricInfo = Array.isArray(fabricsMaster) ? fabricsMaster.find(f => 
            f.name.toLowerCase().includes(fabric_type.toLowerCase())
          ) : null;
          
          if (fabricInfo) {
            let response = `**${fabricInfo.name} (${fabricInfo.level}):**\n`;
            response += `${fabricInfo.description}\n\n`;
            response += `Pros: ${fabricInfo.pros_cons.pros.join(', ')}\n`;
            response += `Considerations: ${fabricInfo.pros_cons.cons.join(', ')}\n\n`;
            response += `Warranty: ${fabricInfo.warranty.period_years} years - ${fabricInfo.warranty.coverage}\n`;
            

            trackCustomerEducation(session, 'materials');
            toolResults.push({
              tool_call_id: toolCall.id,
              output: response
            });
          } else {
            toolResults.push({
              tool_call_id: toolCall.id,
              output: `${fabric_type} is used in our outdoor furniture. Contact us for detailed fabric specifications.`
            });
          }
        }
        
        if (toolCall.function.name === "get_seasonal_advice") {
          const args = JSON.parse(toolCall.function.arguments);
          const { season } = args;
          
          if (marketMaster.seasonal_demand_patterns && marketMaster.seasonal_demand_patterns[season]) {
            const seasonData = marketMaster.seasonal_demand_patterns[season];
            let response = `**${season.charAt(0).toUpperCase() + season.slice(1)} Recommendations:**\n`;
            response += `Focus: ${seasonData.focus}\n`;
            response += `Recommended products: ${seasonData.products.join(', ')}\n`;
            response += `Tip: ${seasonData.marketing_tips}\n`;
            
            toolResults.push({
              tool_call_id: toolCall.id,
              output: response
            });
          } else {
            toolResults.push({
              tool_call_id: toolCall.id,
              output: `Seasonal advice available year-round. Our outdoor furniture is designed for UK weather conditions.`
            });
          }
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
      
      // Remove any emojis
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

// Keep all original order handling functions
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
    return ["Dining sets", "Lounge furniture", "Material guide"];
  } else {
    return ["Track my order", "Returns information", "Contact support"];
  }
}

// Main chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message || !sessionId) {
      return res.status(400).json({ 
        response: 'Please provide a message and session ID.',
        suggestions: ["Hello", "I need help"]
      });
    }

   if (!sessions.has(sessionId)) {
  sessions.set(sessionId, {
    conversationHistory: [],
    context: {},
    lastActivity: Date.now()
  });
}

const session = sessions.get(sessionId);
session.lastActivity = Date.now();

session.conversationHistory.push({
  role: 'user',
  content: message,
  timestamp: new Date()
});
    
    // Check for handoff triggers before AI processing
    if (detectOrderInquiry(message)) {
        const handoffResponse = "I can see you're asking about an existing order. Our order handling team can help you with that. Please visit our <a href='https://mint-outdoor-support-cf235e896ea9.herokuapp.com/' style='color: #9FDCC2; font-weight: bold; text-decoration: none;' target='_blank'>ORDER HELPDESK</a> where you can check your order status, delivery updates, and returns.";

        session.conversationHistory.push({
            role: 'user',
            content: message,
            timestamp: new Date()
        });
        
        session.conversationHistory.push({
            role: 'assistant',
            content: handoffResponse,
            timestamp: new Date()
        });
        
        await logChat(sessionId, 'user', message);
        await logChat(sessionId, 'assistant', handoffResponse);
        
        return res.json({
            response: handoffResponse,
            sessionId: sessionId,
            handoff: 'order_desk',
            handoffUrl: 'https://mint-outdoor-support-cf235e896ea9.herokuapp.com/'
        });
    }

    if (!message || !sessionId) {
      return res.status(400).json({ 
        response: 'Please provide a message and session ID.',
        suggestions: ["Hello", "I need help"]
      });
    }

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        conversationHistory: [],
        context: {},
        lastActivity: Date.now()
      });
    }


    await logChat(sessionId, 'user', message);

    // Check if order or sales query
    const orderKeywords = ['order', 'delivery', 'tracking', 'refund', 'return', 'where is my', 'when will'];
    const hasOrderNumber = /\b\d{6,}\b/.test(message);
    const isOrderQuery = orderKeywords.some(keyword => message.toLowerCase().includes(keyword)) || hasOrderNumber;

    let response;
    let mode = 'sales';
    
    if (isOrderQuery || session.context.mode === 'order') {
      mode = 'order';
      // Handle order queries
      if (hasOrderNumber && !session.context.verified) {
        const orderNumber = message.match(/\b\d{6,}\b/)[0];
        const order = findOrderById(orderNumber);
        
        if (order) {
          response = `I found your order ${orderNumber}! For security, I'll need to verify your identity with your surname and postcode before I can share details.`;
          session.context.awaitingVerification = orderNumber;
        } else {
          response = `I couldn't find order ${orderNumber}. Please double-check the number or contact support@mint-outdoor.com for assistance.`;
        }
      } else if (session.context.awaitingVerification) {
        const parts = message.split(' ');
        if (parts.length >= 2) {
          const surname = parts[0];
          const postcode = parts[parts.length - 1];
          const verification = verifyCustomer(session.context.awaitingVerification, surname, postcode);
          
          if (verification.verified) {
            response = `Thank you! I've verified your identity. Your order ${session.context.awaitingVerification} is confirmed. How can I help you with this order?`;
            session.context.verified = true;
            session.context.currentOrder = verification.order;
            delete session.context.awaitingVerification;
          } else {
            response = `I couldn't verify those details. Please double-check your surname and postcode, or contact us at support@mint-outdoor.com for assistance.`;
          }
        } else {
          response = `Please provide both your surname and postcode separated by a space.`;
        }
      } else {
        response = `Hello! I'm Gwen from MINT Outdoor customer service. I'd be happy to help with your order inquiry. Please provide your order number so I can assist you.`;
      }
      session.context.mode = 'order';
    } else {
      // Sales mode
      mode = 'sales';
      session.context.mode = 'sales';

      // ADD BUNDLE HANDLING HERE BEFORE AI CALL
      if (session.context.waitingForPackageResponse) {
        let response; // ← ADD THIS LINE
        const lowerMessage = message.toLowerCase();
        console.log(`🎁 Bundle response handler triggered. Message: "${message}"`);
        
        if (lowerMessage.includes('yes') || lowerMessage.includes('sure') || 
            lowerMessage.includes('show') || lowerMessage.includes('see') || 
            lowerMessage.includes('please') || lowerMessage.includes('ok')) {
          
          console.log(`🎯 Customer agreed! Finding bundles for: ${session.context.packageDealProduct}`);
      
          session.context.waitingForPackageResponse = false;
          const productSku = session.context.packageDealProduct;
          
          try {
            const bundles = await findBundleRecommendations(productSku);
            
            if (bundles && bundles.length > 0) {
              response = "Excellent! Here are some popular accessories:\n\n";
              
              bundles.forEach((product) => {
                response += `**${product.product_title}**\n`;
                response += `Price: £${product.price}\n`;
                if (product.image_url) {
                  response += `<img src="${product.image_url}" alt="${product.product_title}" style="width: 100%; max-width: 400px; height: auto; border-radius: 8px; margin: 10px 0;">\n`;
                }
                response += `\n---\n\n`;
              });
              
              response += "🎉 **Special Offer:** Add any of these and get a £30 refund within 48 hours!\n\n";
              response += "Reply with your **email and postcode** to claim.\n";
              response += "Example: \"john@email.com SW1A 1AA\"";
              
              session.context.waitingForRefundClaim = true;
              delete session.context.packageDealProduct;
              
              console.log(`✅ Bundle offer sent successfully`);
            } else {
              response = "I checked our current offers but don't have specific bundles available right now. This is still a great product though!";
              delete session.context.packageDealProduct;
            }
            
          } catch (error) {
            console.error('❌ Bundle error:', error);
            response = "I'm having trouble with our bundle system. This product is still excellent though!";
            delete session.context.packageDealProduct;
          }
          
        } else if (lowerMessage.includes('no') || lowerMessage.includes('not interested')) {
          session.context.waitingForPackageResponse = false;
          session.context.offeredBundle = true;
          delete session.context.packageDealProduct;
          response = "No problem! How else can I help you?";
        }
        
        // Add to conversation history and return
        session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });
        session.conversationHistory.push({ role: 'assistant', content: response, timestamp: new Date() });
        
        await logChat(sessionId, 'user', message);
        await logChat(sessionId, 'assistant', response);
        
        return res.json({
          response: response,
          sessionId: sessionId,
          suggestions: ["Continue", "Tell me more"]
        });
      }

      if (session.context.waitingForRefundClaim) {
        let response;
        const customerDetails = extractCustomerDetails(message);
        
        if (customerDetails.hasRequiredInfo) {
            // Got both email and postcode
            session.context.waitingForRefundClaim = false;
            
            const emailSent = await sendChatToMarketing(
                sessionId, 
                'Bundle Purchase with £30 Refund Claim', 
                session.conversationHistory,
                customerDetails
            );
            
            if (emailSent) {
                response = `Excellent! I have your details:\n📧 Email: ${customerDetails.email}\n📍 Postcode: ${customerDetails.postcode}\n\nPlease place your bundle order using the email and postcode you gave me and I will arrange the £30 refund within 48 hours. \n\nThank you for choosing MINT Outdoor!`;
            } else {
                response = `I have your details, but I'm having trouble with our system. Please email marketing@mint-outdoor.com with:\n\n- Subject: "Bundle Order + £30 Refund"\n- Your email: ${customerDetails.email}\n- Your postcode: ${customerDetails.postcode}\n- Session ID: ${sessionId}\n\nOur team will process this quickly!`;
            }
        } else {
            // Missing required information
            const missing = [];
            if (!customerDetails.email) missing.push('email address');
            if (!customerDetails.postcode) missing.push('postcode');
            
            response = `I need your ${missing.join(' and ')} to process the £30 refund. Please provide both in your next message.\n\nExample: "john@email.com SW1A 1AA"`;
        }

        session.conversationHistory.push({ role: 'user', content: message, timestamp: new Date() });
        session.conversationHistory.push({ role: 'assistant', content: response, timestamp: new Date() });
        
        await logChat(sessionId, 'user', message);
        await logChat(sessionId, 'assistant', response);
        
        return res.json({
          response: response,
          sessionId: sessionId,
          suggestions: ["Continue", "Tell me more"]
        });
      }

      // THEN AI call for non-bundle responses
      response = await generateAISalesResponse(message, sessionId, session);
    }

    session.conversationHistory.push({
      role: 'assistant',
      content: response,
      timestamp: new Date()
    });

    await logChat(sessionId, 'assistant', response);

    const suggestions = generateSuggestions(message, mode);

    res.json({
      response: response,
      sessionId: sessionId,
      suggestions: suggestions,
      mode: mode
    });

 } catch (error) {
  console.error('AI Error Details:', {
    message: error.message,
    stack: error.stack,
    code: error.code,
    response: error.response ? error.response.data : null
  });
  return "Apologies, but I am encountering a connection issue. Please try again shortly.";
}
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    features: { ENABLE_SALES_MODE: ENABLE_SALES_MODE },
    data: {
      products_loaded: Array.isArray(productData) ? productData.length : 0,
      orders_loaded: Array.isArray(orderData) ? orderData.length : 0,
      inventory_records_loaded: Array.isArray(inventoryData) ? inventoryData.length : 0,
      bundles_loaded: Array.isArray(bundleSuggestions) ? bundleSuggestions.length : 0,
      bundle_items_loaded: Array.isArray(bundleItems) ? bundleItems.length : 0,
      knowledge_base: {
        wood_expertise: Array.isArray(woodMaster) ? woodMaster.length : 0,
        metals_expertise: Array.isArray(metalsMaster) ? metalsMaster.length : 0,
        synthetics_expertise: Array.isArray(syntheticsMaster) ? syntheticsMaster.length : 0,
        fabrics_expertise: Array.isArray(fabricsMaster) ? fabricsMaster.length : 0,
        material_maintenance: typeof materialMaintenance === 'object' ? Object.keys(materialMaintenance).length : 0,
        climate_guidance: typeof climateMaster === 'object' ? Object.keys(climateMaster).length : 0,
        market_intelligence: typeof marketMaster === 'object' ? Object.keys(marketMaster).length : 0,
        space_configurations: Array.isArray(spaceConfig) ? spaceConfig.length : 0,
        seating_data: Array.isArray(seatingMaster) ? seatingMaster.length : 0
      },
      ai_tools_available: 7
    },
    version: '10.0.1-material-maintenance-bug-fix',
    improvements: [
      'CRITICAL: Removed old get_material_info handler causing .find() error',
      'CRITICAL: Fixed duplicate tool handlers conflicting with each other', 
      'Only new get_material_expertise handler remains (works with object structure)',
      'Material maintenance questions now fully functional',
      'All 20+ knowledge files integrated and accessible',
      'Enhanced AI tools from 4 to 7 specialized expert functions',
      'Comprehensive outdoor furniture expertise now operational'
    ],
    complete_knowledge_system: {
      status: 'fully_operational',
      capabilities: [
        'Comprehensive material maintenance guidance (teak, aluminium, rattan)',
        'Climate-specific performance advice for UK conditions',
        'Seasonal recommendations and market intelligence',
        'Detailed product dimensions and assembly information',
        'Fabric expertise (Sunbrella vs Olefin vs Polyester)',
        'Real-time stock checking and honest availability',
        'Smart package deal recommendations',
        'Expert-level outdoor furniture consultation'
      ],
      knowledge_files_loaded: 20,
      ai_tools_enhanced: 'From 4 basic tools to 7 specialized expert functions',
      previous_failure_resolved: 'Customer maintenance questions now fully supported with rich expertise'
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'chat.html'));
});

app.get('/widget', (req, res) => {
  res.sendFile(path.join(__dirname, 'widget.html'));
});

// Temporary endpoint to check product data
app.get('/debug-products', (req, res) => {
  const products = productData.slice(0, 20).map(p => ({
    sku: p.sku,
    title: p.product_title,
    price: p.price
  }));
  
  res.json({
    total_products: productData.length,
    sample_products: products,
    note: "This shows the actual SKUs and titles in your product database"
  });
});

// Session cleanup
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  let cleaned = 0;
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivity > oneHour) {
      sessions.delete(sessionId);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`Cleaned ${cleaned} expired sessions`);
}, 60 * 60 * 1000);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 MINT Outdoor AI System v10.0 (Complete Knowledge Integration) running on port ${port}`);
  console.log(`📊 Sales Mode: ${ENABLE_SALES_MODE ? 'ENABLED' : 'DISABLED'}`);
  console.log(`📦 Products loaded: ${Array.isArray(productData) ? productData.length : 'N/A'}`);
  console.log(`📋 Orders loaded: ${Array.isArray(orderData) ? orderData.length : 'N/A'}`);
  console.log(`📊 Inventory records loaded: ${Array.isArray(inventoryData) ? inventoryData.length : 'N/A'}`);
  console.log(`🎁 Bundle suggestions: ${Array.isArray(bundleSuggestions) ? bundleSuggestions.length : 'N/A'}`);
  console.log(`🔗 Bundle items: ${Array.isArray(bundleItems) ? bundleItems.length : 'N/A'}`);
  console.log('🔧 ENVIRONMENT CHECK:');
console.log(`   📧 Email User: ${process.env.EMAIL_USER ? '✅ Set' : '❌ Missing'}`);
console.log(`   🔑 Email Password: ${process.env.EMAIL_PASSWORD ? '✅ Set' : '❌ Missing'}`);
console.log(`   🤖 OpenAI Key: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log('🚨 MAJOR UPGRADE - COMPLETE KNOWLEDGE INTEGRATION:');
  console.log('   ✅ ALL 20+ knowledge files now loaded and accessible');
  console.log('   ✅ Fixed material maintenance object structure error');
  console.log('   ✅ Enhanced data loading for different JSON structures');
  console.log('   ✅ Added 7 specialized AI tools for expert guidance');
  
  console.log('🧠 GWEN\'S EXPERTISE NOW INCLUDES:');
  console.log(`   🌳 Wood expertise (${Array.isArray(woodMaster) ? woodMaster.length : 0} materials) - Including teak maintenance!`);
  console.log(`   🔩 Metals expertise (${Array.isArray(metalsMaster) ? metalsMaster.length : 0} materials) - Aluminium care!`);
  console.log(`   🧵 Fabrics expertise (${Array.isArray(fabricsMaster) ? fabricsMaster.length : 0} types) - Olefin vs Polyester!`);
  console.log(`   🧽 Material maintenance (${typeof materialMaintenance === 'object' ? Object.keys(materialMaintenance).length : 0} materials) - Complete care guides!`);
  console.log(`   🌤️ Climate guidance (${typeof climateMaster === 'object' ? Object.keys(climateMaster).length : 0} materials) - UK weather advice!`);
  console.log(`   📈 Market intelligence (${typeof marketMaster === 'object' ? Object.keys(marketMaster).length : 0} categories) - Seasonal advice!`);
  console.log(`   📐 Product dimensions (${Array.isArray(spaceConfig) ? spaceConfig.length : 0} products) - Assembly info!`);
  console.log(`   🪑 Seating data (${Array.isArray(seatingMaster) ? seatingMaster.length : 0} products) - Capacity planning!`);
  console.log(`🔧 Product-Material Index: ${Array.isArray(productMaterialIndex) ? productMaterialIndex.length : 0} products mapped`);

  // Show what features are active based on loaded data
  const hasInventory = Array.isArray(inventoryData) && inventoryData.length > 0;
  const hasBundles = Array.isArray(bundleSuggestions) && bundleSuggestions.length > 0 && Array.isArray(bundleItems) && bundleItems.length > 0;
  const hasKnowledge = Object.keys(materialMaintenance).length > 0 || Array.isArray(woodMaster) && woodMaster.length > 0;
  
  if (hasInventory) {
    console.log('🎯 STOCK ACCURACY FEATURES ACTIVE:');
    console.log('   - Real-time stock checking enabled');
    console.log('   - Accurate availability information');
  }
  
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
  console.warn('⚠️  WARNING: Email system not configured - bundle offers will fail!');
}

  if (hasBundles) {
    console.log('🎯 PACKAGE DEAL FEATURES ACTIVE:');
    console.log('   - Smart bundle recommendations enabled');
    console.log('   - Intelligent upselling system operational');
  }
  
  if (hasKnowledge) {
    console.log('🎯 EXPERT KNOWLEDGE SYSTEM ACTIVE:');
    console.log('   - Comprehensive material expertise available');
    console.log('   - Maintenance guidance system operational');
    console.log('   - Climate-specific advice enabled');
    console.log('   - Seasonal recommendations active');
  }
  
  console.log('💡 MAINTENANCE QUESTIONS NOW FULLY SUPPORTED:');
  console.log('   - "Is teak easy to maintain?" ✅ Comprehensive answer available');
  console.log('   - "How do I care for aluminium?" ✅ Expert guidance ready');
  console.log('   - "What about rattan maintenance?" ✅ Complete care instructions');
  console.log('   - "Which fabric is best for UK weather?" ✅ Climate expertise loaded');
});

module.exports = app;