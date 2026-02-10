// GWEN SALES AGENT - PHASE 1 CORRECT IMPLEMENTATION
// Version: 15.0
// 
// ARCHITECTURE:
// 1. AI handles CONVERSATION (greetings, questions, qualifying, objections)
// 2. AI outputs SKUs only for product recommendations
// 3. SERVER renders product cards from verified data
// 4. Out-of-stock products filtered BEFORE AI sees them
//
// THE AI CAN WRITE CONVERSATIONAL TEXT
// THE AI CANNOT WRITE PRODUCT NAMES, PRICES, OR FEATURES

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
const fs = require('fs');
const nodemailer = require('nodemailer');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Email configuration - Supports both Gmail and Google Workspace
// For Google Workspace (custom domain like @mint-outdoor.com), use SMTP settings
const emailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Use TLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Verify email configuration on startup
emailTransporter.verify((error, success) => {
    if (error) {
        console.log('âŒ Email configuration ERROR:', error.message);
        console.log('   EMAIL_USER:', process.env.EMAIL_USER ? 'âœ… Set' : 'âŒ Missing');
        console.log('   EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? 'âœ… Set' : 'âŒ Missing');
    } else {
        console.log('âœ… Email server ready - can send escalations');
    }
});

// ============================================
// ESCALATION EMAIL FUNCTION
// ============================================

async function sendEscalationEmail(customerEmail, customerName, reason, conversationHistory, productsDiscussed = []) {
    // Use environment variable, fallback to help@mint-outdoor.com
    const supportEmail = process.env.ESCALATION_EMAIL || 'help@mint-outdoor.com';
    
    console.log(`ðŸ“§ ============================================`);
    console.log(`ðŸ“§ ESCALATION EMAIL ATTEMPT`);
    console.log(`ðŸ“§ To: ${supportEmail}`);
    console.log(`ðŸ“§ From: ${process.env.EMAIL_USER}`);
    console.log(`ðŸ“§ Customer: ${customerEmail}`);
    console.log(`ðŸ“§ Reason: ${reason.substring(0, 100)}...`);
    console.log(`ðŸ“§ ============================================`);
    
    // Build conversation transcript
    const transcript = conversationHistory
        .slice(-20) // Last 20 messages
        .map(msg => `[${msg.role?.toUpperCase() || 'UNKNOWN'}]: ${msg.content || ''}`)
        .join('\n\n');
    
    // Build product list if any
    const productList = productsDiscussed.length > 0 
        ? productsDiscussed.map(sku => {
            const product = productIndex?.bySku?.[sku];
            return product 
                ? `â€¢ ${product.product_identity?.product_name} (${sku}) - Â£${product.product_identity?.price_gbp}`
                : `â€¢ ${sku}`;
          }).join('\n')
        : 'No specific products discussed';
    
    const emailContent = {
        from: `"Gwen Sales Agent" <${process.env.EMAIL_USER}>`,
        to: supportEmail,
        replyTo: customerEmail || process.env.EMAIL_USER,
        subject: `ðŸš¨ Gwen Escalation: Customer needs help - ${reason.substring(0, 50)}`,
        html: `
            <h2>Customer Escalation from Gwen Chatbot</h2>
            
            <h3>Customer Details</h3>
            <p><strong>Email:</strong> ${customerEmail || 'Not provided'}</p>
            <p><strong>Name:</strong> ${customerName || 'Not provided'}</p>
            
            <h3>Reason for Escalation</h3>
            <p>${reason}</p>
            
            <h3>Products Discussed</h3>
            <pre>${productList}</pre>
            
            <h3>Conversation Transcript</h3>
            <div style="background:#f5f5f5; padding:15px; border-radius:8px; white-space:pre-wrap; font-family:monospace; font-size:12px;">
${transcript}
            </div>
            
            <hr>
            <p style="color:#666; font-size:11px;">
                This email was automatically sent by Gwen Sales Agent.<br>
                Please respond to the customer at: ${customerEmail || 'EMAIL NOT PROVIDED - check conversation for contact details'}
            </p>
        `,
        text: `
CUSTOMER ESCALATION FROM GWEN CHATBOT

Customer Email: ${customerEmail || 'Not provided'}
Customer Name: ${customerName || 'Not provided'}

Reason: ${reason}

Products Discussed:
${productList}

Conversation:
${transcript}
        `
    };
    
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            console.log(`âŒ Email credentials not configured`);
            console.log(`   EMAIL_USER: ${process.env.EMAIL_USER ? 'Set' : 'MISSING'}`);
            console.log(`   EMAIL_PASSWORD: ${process.env.EMAIL_PASSWORD ? 'Set' : 'MISSING'}`);
            return { success: false, message: 'Email credentials not configured' };
        }
        
        const info = await emailTransporter.sendMail(emailContent);
        console.log(`âœ… ESCALATION EMAIL SENT SUCCESSFULLY`);
        console.log(`   Message ID: ${info.messageId}`);
        console.log(`   To: ${supportEmail}`);
        console.log(`   Customer: ${customerEmail}`);
        return { success: true, message: 'Escalation email sent', messageId: info.messageId };
        
    } catch (error) {
        console.log(`âŒ ESCALATION EMAIL FAILED`);
        console.log(`   Error: ${error.message}`);
        console.log(`   Code: ${error.code || 'N/A'}`);
        console.log(`   Response: ${error.response || 'N/A'}`);
        
        // Log more details for common errors
        if (error.code === 'EAUTH') {
            console.log(`   ðŸ’¡ Fix: Check EMAIL_PASSWORD - may need App Password from Google`);
            console.log(`   ðŸ’¡ Go to: https://myaccount.google.com/apppasswords`);
        }
        if (error.code === 'ESOCKET' || error.code === 'ECONNECTION') {
            console.log(`   ðŸ’¡ Fix: Network/firewall issue - check Heroku can reach smtp.gmail.com`);
        }
        
        return { success: false, message: error.message, code: error.code };
    }
}

// Database setup
const { Pool } = require('pg');
const pool = process.env.DATABASE_URL ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
}) : null;

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ============================================
// CONVERSATION LOGGING - Database Tables
// ============================================

async function initConversationLogging() {
    if (!pool) {
        console.log('âš ï¸ No database - conversation logging disabled');
        return;
    }
    
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS conversation_messages (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                intent VARCHAR(100),
                products_shown TEXT,
                sentiment VARCHAR(50),
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_conv_session 
            ON conversation_messages(session_id)
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_conv_created 
            ON conversation_messages(created_at DESC)
        `);
        
        console.log('âœ… Conversation logging tables ready');
    } catch (error) {
        console.error('âš ï¸ Failed to create conversation tables:', error.message);
    }
}

// Call this on startup
initConversationLogging();

async function logConversationMessage(sessionId, role, content, metadata = {}) {
    if (!pool) return;
    
    try {
        await pool.query(`
            INSERT INTO conversation_messages 
            (session_id, role, content, intent, products_shown, sentiment)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            sessionId,
            role,
            content,
            metadata.intent || null,
            metadata.productsShown ? JSON.stringify(metadata.productsShown) : null,
            metadata.sentiment || null
        ]);
    } catch (error) {
        console.error('âš ï¸ Failed to log conversation:', error.message);
        // Don't throw - logging failure should never break the chat
    }
}

const ENABLE_SALES_MODE = process.env.ENABLE_SALES_MODE === 'true';
const sessions = new Map();

// Shopify configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_URL || 'bb69ce-b5.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ============================================
// SHOPIFY CACHING SYSTEM (5-minute TTL)
// ============================================

const SHOPIFY_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getCachedShopifyData(sku) {
    const cached = SHOPIFY_CACHE.get(sku);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
        return cached.data;
    }
    
    if (!SHOPIFY_ACCESS_TOKEN) {
        return null;
    }
    
    try {
        const response = await fetch(
            `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?handle=${sku.toLowerCase()}`,
            {
                headers: {
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!response.ok) return null;
        
        const data = await response.json();
        const product = data.products?.[0];
        
        if (!product) return null;
        
        const result = {
            price: parseFloat(product.variants[0]?.price) || 0,
            stock: product.variants[0]?.inventory_quantity || 0,
            url: `https://www.mint-outdoor.com/products/${product.handle}`,
            available: product.variants[0]?.inventory_quantity > 0,
            title: product.title
        };
        
        SHOPIFY_CACHE.set(sku, { data: result, timestamp: Date.now() });
        return result;
        
    } catch (error) {
        console.error(`Shopify error for ${sku}:`, error.message);
        return null;
    }
}

// ============================================
// DATA LOADING
// ============================================

function loadDataFile(filename, defaultValue = []) {
    const dataPath = path.join(__dirname, 'data', filename);
    try {
        const rawData = fs.readFileSync(dataPath, 'utf8');
        const parsedData = JSON.parse(rawData);
        console.log(`âœ… Loaded ${filename}`);
        return parsedData;
    } catch (error) {
        console.error(`=ÂÅ’ Failed to load ${filename}: ${error.message}`);
        return defaultValue;
    }
}

const productKnowledgeCenter = loadDataFile('product_knowledge_center.json', []);
const rawInventoryData = loadDataFile('Inventory_Data.json', { inventory: [] });
const inventoryData = Array.isArray(rawInventoryData) ? rawInventoryData : (rawInventoryData.inventory || []);
const bundleSuggestions = loadDataFile('bundle_suggestions.json', []);
const bundleItems = loadDataFile('bundle_items.json', []);
const demandPlanDashboard = loadDataFile('demand_plan_dashboard.json', { data: [] });
console.log(`📊 Demand dashboard: ${demandPlanDashboard.data?.length || 0} SKU forecasts`);

console.log(`ðŸ“¦ Inventory data type: ${typeof rawInventoryData}`);
console.log(`ðŸ“¦ Inventory is array after processing: ${Array.isArray(inventoryData)}`);
console.log(`ðŸ“¦ Inventory length: ${inventoryData.length}`);

// Check FARO specifically
const faroInventory = inventoryData.find(i => i.sku === 'FARO-LOUNGE-SET');
if (faroInventory) {
    console.log(`âœ… FARO-LOUNGE-SET in inventory: available=${faroInventory.available}`);
} else {
    console.log(`=ÂÅ’ FARO-LOUNGE-SET NOT in inventory array`);
    console.log(`   First 3 inventory SKUs: ${inventoryData.slice(0, 3).map(i => i.sku).join(', ')}`);
}

// Build product index
const productIndex = { bySku: {} };
productKnowledgeCenter.forEach(product => {
    const sku = product.product_identity?.sku;
    if (sku) {
        productIndex.bySku[sku] = product;
    }
});

console.log(`ðŸ“¦ Indexed ${Object.keys(productIndex.bySku).length} products`);
console.log(`ðŸ“¦ Inventory records: ${inventoryData.length}`);

// Verify specific product exists
const testProduct = productIndex.bySku['FARO-LOUNGE-SET'];
if (testProduct) {
    console.log(`âœ… FARO-LOUNGE-SET found in index:`);
    console.log(`   - Name: ${testProduct.product_identity?.product_name}`);
    console.log(`   - Material: ${testProduct.description_and_category?.material_type}`);
    console.log(`   - Taxonomy: ${testProduct.description_and_category?.taxonomy_type}`);
    console.log(`   - Seats: ${testProduct.specifications?.seats} (type: ${typeof testProduct.specifications?.seats})`);
} else {
    console.log(`=ÂÅ’ FARO-LOUNGE-SET NOT FOUND in index!`);
    console.log(`   Sample SKUs: ${Object.keys(productIndex.bySku).slice(0, 5).join(', ')}`);
}

// Count rattan products
const rattanCount = Object.values(productIndex.bySku).filter(p => 
    p.description_and_category?.material_type?.toLowerCase() === 'rattan'
).length;
console.log(`ðŸ“¦ Rattan products: ${rattanCount}`);

// ============================================
// AUTO-BUILT PRODUCT FAMILY MAP
// ============================================
const PRODUCT_FAMILIES = {};
const FAMILY_ALIASES = {};

productKnowledgeCenter.forEach(p => {
    const sku = p.product_identity?.sku;
    const name = (p.product_identity?.product_name || '').toLowerCase();
    const explicitFamily = p.product_identity?.product_family;
    const category = p.description_and_category?.primary_category || '';
    const subCategory = p.description_and_category?.sub_category || '';
    const taxonomy = p.description_and_category?.taxonomy_type || '';
    
    if (!sku) return;
    if (['2-PERSON-DELIVERY', 'ASSEMBLY-SERVICE', 'DELIVERY-CHARGE', 'ASSEMBLY-ADD-ON', 'COLLECTION-FEE'].includes(sku)) return;
    
    let familyName = '';
    if (explicitFamily && explicitFamily.trim()) {
        familyName = explicitFamily.trim().toUpperCase();
    } else {
        const nameWords = name.split(/\s+/);
        const firstWord = nameWords[0];
        if (firstWord && firstWord.length > 2 && !['the', 'set', 'garden'].includes(firstWord)) {
            familyName = firstWord.toUpperCase();
        }
    }
    
    if (!familyName) return;
    
    const isReplacementCushion = name.includes('replacement cushion') || name.includes('replacement cover');
    const isCover = (name.includes('cover') || name.includes('fitted furniture cover') || name.includes('protective') || subCategory === 'covers') && !isReplacementCushion;
    const isCushionBox = name.includes('cushion box');
    const isParasol = name.includes('parasol') || subCategory === 'parasols';
    const isAccessory = taxonomy === 'accessories' || category === 'Accessories';
    
    let productType = 'unknown';
    if (isReplacementCushion) productType = 'replacement_part';
    else if (isCover) productType = 'cover';
    else if (isCushionBox) productType = 'cushion_box';
    else if (isParasol) productType = 'parasol';
    else if (isAccessory && !isCover && !isCushionBox) productType = 'accessory';
    else if (taxonomy === 'dining' || taxonomy === 'lounge' || taxonomy === 'sunlounger') productType = 'furniture';
    else if (category.includes('Sets') || category.includes('Lounge') || category.includes('Dining') || category.includes('Sun Lounger')) productType = 'furniture';
    else if (name.includes('sofa') || name.includes('dining set') || name.includes('lounge set') || name.includes('corner')) productType = 'furniture';
    
    if (!PRODUCT_FAMILIES[familyName]) {
        PRODUCT_FAMILIES[familyName] = { furniture: [], covers: [], cushion_boxes: [], replacement_parts: [], accessories: [] };
    }
    
    if (productType === 'furniture') PRODUCT_FAMILIES[familyName].furniture.push(sku);
    else if (productType === 'cover') PRODUCT_FAMILIES[familyName].covers.push(sku);
    else if (productType === 'cushion_box') PRODUCT_FAMILIES[familyName].cushion_boxes.push(sku);
    else if (productType === 'replacement_part') PRODUCT_FAMILIES[familyName].replacement_parts.push(sku);
    else PRODUCT_FAMILIES[familyName].accessories.push(sku);
    
    const skuPrefix = sku.split('-')[0].toUpperCase();
    if (skuPrefix !== familyName && skuPrefix.length > 2) {
        FAMILY_ALIASES[skuPrefix] = familyName;
    }
});

FAMILY_ALIASES['FARO'] = 'PALMA';
FAMILY_ALIASES['MALAGA'] = 'CHESTERTON';
FAMILY_ALIASES['CHES'] = 'CHESTERTON';
FAMILY_ALIASES['STOCK'] = 'STOCKHOLM';
FAMILY_ALIASES['CAL'] = 'CALIFORNIA';
FAMILY_ALIASES['OLIVIA'] = 'SICILY';
FAMILY_ALIASES['PLAY'] = 'SONNY';

const familyCount = Object.keys(PRODUCT_FAMILIES).length;
const familiesWithFurniture = Object.entries(PRODUCT_FAMILIES).filter(([k,v]) => v.furniture.length > 0).length;
console.log(`Family map: ${familyCount} families, ${familiesWithFurniture} with furniture`);

// ============================================
// HELPER: Identify accessory products
// ============================================
function isAccessoryProduct(product) {
    const taxonomyType = (product.description_and_category?.taxonomy_type || '').toLowerCase();
    const primaryCategory = (product.description_and_category?.primary_category || '').toLowerCase();
    const name = (product.product_identity?.product_name || '').toLowerCase();
    
    return taxonomyType === 'accessories' || 
           primaryCategory === 'accessories' ||
           name.includes('cover') ||
           name.includes('cushion box') ||
           name.includes('replacement') ||
           name.includes('parasol');
}

// ============================================
// HELPER: Resolve family name from user input
// ============================================
function resolveFamily(input) {
    const upper = input.toUpperCase().trim();
    if (PRODUCT_FAMILIES[upper]) return upper;
    if (FAMILY_ALIASES[upper]) return FAMILY_ALIASES[upper];
    for (const familyName of Object.keys(PRODUCT_FAMILIES)) {
        if (familyName.includes(upper) || upper.includes(familyName)) return familyName;
    }
    return null;
}

// ============================================
// FAMILY + TYPE PARSER
// ============================================
function parseFamilyAndType(message) {
    const msgLower = message.toLowerCase();
    const result = { family: null, requestedType: null };
    
    const allFamilyNames = Object.keys(PRODUCT_FAMILIES);
    const allSearchTerms = [...allFamilyNames, ...Object.keys(FAMILY_ALIASES)];
    
    for (const term of allSearchTerms) {
        const termLower = term.toLowerCase();
        if (termLower.length < 3) continue;
        if (msgLower.includes(termLower)) {
            result.family = FAMILY_ALIASES[term] || term;
            break;
        }
    }
    
    if (!result.family) return result;
    
    if (msgLower.includes('cover') && !msgLower.includes('not the cover') && !msgLower.includes('not a cover') && !msgLower.includes('no cover')) {
        result.requestedType = 'cover';
    }
    else if (msgLower.includes('cushion') && !msgLower.includes('not the cushion') && !msgLower.includes('not cushion') && !msgLower.includes('no cushion')) {
        if (msgLower.includes('cushion box') || msgLower.includes('storage')) {
            result.requestedType = 'cushion_box';
        } else if (msgLower.includes('replacement') || msgLower.includes('spare')) {
            result.requestedType = 'replacement_part';
        } else {
            result.requestedType = 'cushion';
        }
    }
    else if (msgLower.includes('replacement') || msgLower.includes('spare')) {
        result.requestedType = 'replacement_part';
    }
    else if (msgLower.includes('set') || msgLower.includes('sofa') || msgLower.includes('dining') || 
             msgLower.includes('lounge') || msgLower.includes('corner') || msgLower.includes('furniture') ||
             msgLower.includes('table') || msgLower.includes('seater')) {
        result.requestedType = 'furniture';
    }
    else {
        result.requestedType = 'furniture_priority';
    }
    
    console.log(`Family parser: family=${result.family}, type=${result.requestedType}`);
    return result;
}

// ============================================
// STOCK STATUS (3-tier: in_stock, pre_order, out_of_stock)
// ============================================
function getStockStatus(sku) {
    const regularStock = getProductStock(sku);
    
    const demandInfo = demandPlanDashboard.data?.find(d => 
        d.parentSku === sku || 
        d.parentSku?.toLowerCase() === sku.toLowerCase()
    );
    
    if (regularStock > 0) {
        return {
            status: 'in_stock',
            quantity: regularStock,
            message: 'In stock with 3-5 day delivery',
            canOrder: true
        };
    }
    
    if (demandInfo) {
        const nextArrival = demandInfo.stockProjection?.find(sp => sp.poArrival > 0);
        if (nextArrival) {
            return {
                status: 'pre_order',
                expectedMonth: nextArrival.month,
                expectedQuantity: nextArrival.poArrival,
                message: 'Available for pre-order! Expected delivery: ' + nextArrival.month + ' 2026',
                canOrder: true
            };
        }
        if (demandInfo.supplyStatus === 'CONSTRAINED') {
            return {
                status: 'out_of_stock',
                message: 'Currently out of stock - check website for updates',
                canOrder: false
            };
        }
    }
    
    return { status: 'unknown', message: 'Contact us for availability', canOrder: true };
}


// ============================================
// STOCK CHECKING - Filter BEFORE AI sees products
// ============================================

function getProductStock(sku) {
    let stockFromInventory = 0;
    let stockFromPKC = 0;
    
    // Check inventory data
    const invRecord = inventoryData.find(i => i.sku === sku);
    if (invRecord) {
        stockFromInventory = parseInt(invRecord.available) || 0;
    }
    
    // Check product knowledge center
    const product = productIndex.bySku[sku];
    if (product?.logistics_and_inventory?.inventory?.available) {
        stockFromPKC = parseInt(product.logistics_and_inventory.inventory.available) || 0;
    }
    
    // Use the higher value (in case one source is outdated)
    const finalStock = Math.max(stockFromInventory, stockFromPKC);
    
    // Debug logging for troubleshooting
    if (sku === 'FARO-LOUNGE-SET' || finalStock === 0) {
        console.log(`ðŸ“Š getProductStock(${sku}): inventory=${stockFromInventory}, PKC=${stockFromPKC}, using=${finalStock}`);
    }
    
    // If no data at all, default to in stock (100)
    if (stockFromInventory === 0 && stockFromPKC === 0 && !invRecord && !product?.logistics_and_inventory?.inventory) {
        return 100;
    }
    
    return finalStock;
}

function isInStock(sku) {
    return getProductStock(sku) > 0;
}

// ============================================
// PRODUCT SEARCH - Returns ONLY in-stock products
// ============================================

function searchProducts(criteria) {
    const { 
        furnitureType, material, seatCount, productName, maxResults = 5,
        // v15.0: Exclusion and family params
        excludedCategories = [],
        excludedProductTypes = [],
        prioritizeFurniture = false,
        requestedFamily = null,
        requestedFamilyType = null,
        productsAlreadyShown = [],
        includePreOrder = false
    } = criteria;
    
    // Exclude service/delivery SKUs from product searches
    const excludedSkus = ['2-PERSON-DELIVERY', 'ASSEMBLY-SERVICE', 'DELIVERY-CHARGE', 'ASSEMBLY-ADD-ON', 'COLLECTION-FEE'];
    
    let filtered = Object.values(productIndex.bySku).filter(p => 
        p.product_identity?.sku && 
        p.description_and_category?.primary_category &&
        !excludedSkus.includes(p.product_identity.sku.toUpperCase())
    );
    
    console.log(`🔍 Search criteria: type=${furnitureType}, material=${material}, seats=${seatCount}, family=${requestedFamily}, familyType=${requestedFamilyType}`);
    console.log(`🔍 Starting with ${filtered.length} products`);
    
    // ============================================
    // v15.0: FAMILY + TYPE FILTERING (highest priority)
    // ============================================
    if (requestedFamily) {
        const familyData = PRODUCT_FAMILIES[requestedFamily];
        if (familyData) {
            let familySkus = [];
            
            if (requestedFamilyType === 'furniture' || requestedFamilyType === 'furniture_priority') {
                familySkus = familyData.furniture;
            } else if (requestedFamilyType === 'cover') {
                familySkus = familyData.covers;
            } else if (requestedFamilyType === 'cushion_box') {
                familySkus = familyData.cushion_boxes;
            } else if (requestedFamilyType === 'replacement_part' || requestedFamilyType === 'cushion') {
                familySkus = familyData.replacement_parts;
            } else {
                // Show all from family, furniture first
                familySkus = [...familyData.furniture, ...familyData.covers, ...familyData.cushion_boxes, ...familyData.accessories];
            }
            
            if (familySkus.length > 0) {
                const familyFiltered = filtered.filter(p => familySkus.includes(p.product_identity.sku));
                if (familyFiltered.length > 0) {
                    filtered = familyFiltered;
                    console.log(`🏷️ Family filter (${requestedFamily}/${requestedFamilyType}): ${filtered.length} products`);
                } else {
                    console.log(`⚠️ Family filter returned 0 - keeping all ${filtered.length} results`);
                }
            }
        }
    }
    
    // Filter by furniture type
    if (furnitureType && !requestedFamily) {
        const type = furnitureType.toLowerCase();
        const beforeCount = filtered.length;
        const typeFiltered = filtered.filter(p => {
            const taxonomy = (p.description_and_category?.taxonomy_type || '').toLowerCase();
            const category = (p.description_and_category?.primary_category || '').toLowerCase();
            const name = (p.product_identity?.product_name || '').toLowerCase();
            
            if (type === 'dining') return taxonomy.includes('dining') || category.includes('dining') || name.includes('dining');
            if (type === 'lounge') return taxonomy.includes('lounge') || category.includes('lounge') || name.includes('lounge') || name.includes('sofa');
            if (type === 'corner') return taxonomy.includes('corner') || name.includes('corner');
            if (type === 'lounger') return taxonomy.includes('lounger') || taxonomy.includes('sunlounger') || name.includes('lounger') || name.includes('sun');
            if (type === 'accessories') return taxonomy === 'accessories' || category.includes('accessories');
            return true;
        });
        if (typeFiltered.length > 0) {
            filtered = typeFiltered;
        }
        console.log(`🔍 After furniture type filter (${type}): ${filtered.length} products (was ${beforeCount})`);
    }
    
    // Filter by material
    if (material) {
        const mat = material.toLowerCase();
        const beforeCount = filtered.length;
        const matFiltered = filtered.filter(p => {
            const materialType = (p.description_and_category?.material_type || '').toLowerCase();
            const name = (p.product_identity?.product_name || '').toLowerCase();
            return materialType.includes(mat) || name.includes(mat);
        });
        if (matFiltered.length > 0) {
            filtered = matFiltered;
        } else {
            console.log(`⚠️ Material filter (${mat}) returned 0 - keeping ${beforeCount} results`);
        }
        console.log(`🔍 After material filter (${mat}): ${filtered.length} products (was ${beforeCount})`);
    }
    
    // Filter by seat count - STRICT MINIMUM, no irrelevant smaller products
    if (seatCount) {
        const target = parseInt(seatCount);
        const beforeCount = filtered.length;
        
        const matchingProducts = filtered.filter(p => {
            const seats = parseInt(p.specifications?.seats);
            return seats && seats >= target;
        });
        
        console.log(`🔍 After seat filter (>=${target}): ${matchingProducts.length} products (was ${beforeCount})`);
        
        if (matchingProducts.length > 0) {
            matchingProducts.sort((a, b) => {
                const seatsA = parseInt(a.specifications?.seats) || 0;
                const seatsB = parseInt(b.specifications?.seats) || 0;
                return seatsA - seatsB;
            });
            filtered = matchingProducts;
        } else {
            console.log(`   ⚠️ No products with ${target}+ seats, finding largest available`);
            const productsWithSeats = filtered.filter(p => {
                const seats = parseInt(p.specifications?.seats);
                return seats && seats > 0;
            }).sort((a, b) => {
                return (parseInt(b.specifications?.seats) || 0) - (parseInt(a.specifications?.seats) || 0);
            });
            
            if (productsWithSeats.length > 0) {
                const maxSeats = parseInt(productsWithSeats[0].specifications?.seats);
                filtered = productsWithSeats.filter(p => {
                    const seats = parseInt(p.specifications?.seats);
                    return seats >= maxSeats - 1;
                });
                console.log(`   📊 Showing ${filtered.length} products with ${maxSeats} seats (largest available)`);
            }
        }
    }
    
    // Filter by name
    if (productName) {
        const search = productName.toLowerCase();
        const nameFiltered = filtered.filter(p => {
            const name = (p.product_identity?.product_name || '').toLowerCase();
            const sku = (p.product_identity?.sku || '').toLowerCase();
            return name.includes(search) || sku.includes(search);
        });
        if (nameFiltered.length > 0) {
            filtered = nameFiltered;
        }
    }
    
    // ============================================
    // v15.0: APPLY SESSION EXCLUSIONS (with safety fallback)
    // ============================================
    if (excludedCategories.length > 0 || excludedProductTypes.length > 0) {
        const beforeExclusionCount = filtered.length;
        const afterExclusion = filtered.filter(p => {
            const subCategory = (p.description_and_category?.sub_category || '').toLowerCase();
            const taxonomyType = (p.description_and_category?.taxonomy_type || '').toLowerCase();
            const primaryCategory = (p.description_and_category?.primary_category || '').toLowerCase();
            const name = (p.product_identity?.product_name || '').toLowerCase();
            
            for (const excluded of excludedCategories) {
                if (excluded === 'covers' && (subCategory.includes('cover') || name.includes('cover'))) return false;
                if (excluded === 'cushions' && (subCategory.includes('cushion') || name.includes('cushion'))) return false;
                if (excluded === 'boxes' && (subCategory.includes('box') || name.includes('box'))) return false;
            }
            
            for (const excluded of excludedProductTypes) {
                if (excluded === 'accessories' && (taxonomyType === 'accessories' || primaryCategory === 'accessories' || primaryCategory.includes('accessor'))) return false;
            }
            
            return true;
        });
        
        // SAFETY: If exclusions removed everything, fall back
        if (afterExclusion.length === 0 && beforeExclusionCount > 0) {
            console.log(`⚠️ Exclusions removed all results - keeping original ${beforeExclusionCount} products`);
        } else {
            filtered = afterExclusion;
            console.log(`🚫 After exclusions: ${filtered.length} products (was ${beforeExclusionCount})`);
        }
    }
    
    // ============================================
    // v15.0: PRIORITIZE FURNITURE OVER ACCESSORIES (sort, don't filter)
    // ============================================
    if (prioritizeFurniture && filtered.length > 1) {
        filtered.sort((a, b) => {
            const aIsAccessory = isAccessoryProduct(a);
            const bIsAccessory = isAccessoryProduct(b);
            if (aIsAccessory !== bIsAccessory) return aIsAccessory ? 1 : -1;
            return 0;
        });
        console.log(`📦 Prioritized furniture over accessories`);
    }
    
    // ============================================
    // STOCK FILTERING - now with pre-order support
    // ============================================
    const beforeStockCount = filtered.length;
    const inStockProducts = filtered.filter(p => {
        const sku = p.product_identity.sku;
        const stock = getProductStock(sku);
        
        if (stock > 0) return true;
        
        // v15.0: Check for pre-order availability
        if (includePreOrder) {
            const stockStatus = getStockStatus(sku);
            if (stockStatus.status === 'pre_order') {
                console.log(`   📦 Including pre-order item: ${sku} (expected ${stockStatus.expectedMonth})`);
                return true;
            }
        }
        
        console.log(`   ⚠️ Filtering out ${sku} - out of stock`);
        return false;
    });
    
    console.log(`🔍 After stock filter: ${inStockProducts.length} products (was ${beforeStockCount})`);
    
    // ============================================
    // v15.0: SKIP ALREADY-SHOWN PRODUCTS ("show me different")
    // ============================================
    let finalProducts = inStockProducts;
    if (productsAlreadyShown.length > 0) {
        const notYetShown = inStockProducts.filter(p => !productsAlreadyShown.includes(p.product_identity.sku));
        if (notYetShown.length > 0) {
            finalProducts = notYetShown;
            console.log(`🔄 Skipped ${inStockProducts.length - notYetShown.length} already-shown products`);
        } else {
            console.log(`⚠️ All matching products already shown - showing best matches again`);
        }
    }
    
    const results = finalProducts.slice(0, maxResults);
    
    console.log(`🔍 Final results: ${results.map(p => p.product_identity.sku + '(' + (p.specifications?.seats || '?') + ' seats)').join(', ')}`);
    
    return results.map(p => ({
    
        sku: p.product_identity.sku,
        name: p.product_identity.product_name,
        category: p.description_and_category?.primary_category,
        seats: p.specifications?.seats,
        material: p.description_and_category?.material_type
    }));
}


// ============================================
// PRODUCT LOOKUP BY NAME - For dimension queries
// ============================================

function findProductByName(productName, productsShown = []) {
    const searchTerm = productName.toLowerCase().trim();
    
    console.log(`Â Looking for product: "${searchTerm}"`);
    console.log(`   Products shown this session: [${productsShown.join(', ')}]`);
    
    // PRIORITY 1: Check recently shown products first
    if (productsShown.length > 0) {
        for (const sku of productsShown) {
            const product = productIndex.bySku[sku];
            if (product) {
                const name = product.product_identity?.product_name?.toLowerCase() || '';
                const skuLower = sku.toLowerCase();
                const family = product.product_identity?.product_family?.toLowerCase() || '';
                
                // Check if search term matches name, SKU, or family
                if (name.includes(searchTerm) || 
                    skuLower.includes(searchTerm) || 
                    family.includes(searchTerm) ||
                    searchTerm.includes(family)) {
                    console.log(`   âœ… Found in shown products: ${sku}`);
                    return { sku, product, source: 'shown' };
                }
            }
        }
    }
    
    // PRIORITY 2: Search entire database
    for (const [sku, product] of Object.entries(productIndex.bySku)) {
        const name = product.product_identity?.product_name?.toLowerCase() || '';
        const skuLower = sku.toLowerCase();
        const family = product.product_identity?.product_family?.toLowerCase() || '';
        
        if (name.includes(searchTerm) || 
            skuLower.includes(searchTerm.replace(/\s+/g, '-')) ||
            family.includes(searchTerm) ||
            searchTerm.includes(family)) {
            console.log(`   âœ… Found in database: ${sku}`);
            return { sku, product, source: 'database' };
        }
    }
    
    console.log(`   =ÂÅ’ Product not found: "${searchTerm}"`);
    return null;
}

// ============================================
// FIND RELATED ACCESSORIES (cushions, covers, etc.)
// ============================================

function findRelatedAccessories(productSku, accessoryType = null) {
    const product = productIndex.bySku[productSku];
    if (!product) return [];
    
    const productFamily = product.product_identity?.product_family?.toLowerCase() || '';
    const productName = product.product_identity?.product_name?.toLowerCase() || '';
    
    // Extract family name from product name if not set
    const familyFromName = productName.split(' ')[0]; // e.g., "palma" from "Palma Grey..."
    const searchFamily = productFamily || familyFromName;
    
    console.log(`ðŸ” Finding accessories for family: "${searchFamily}"`);
    
    const accessories = [];
    
    for (const [sku, prod] of Object.entries(productIndex.bySku)) {
        // Skip the main product itself
        if (sku === productSku) continue;
        
        const name = prod.product_identity?.product_name?.toLowerCase() || '';
        const category = prod.description_and_category?.primary_category?.toLowerCase() || '';
        const family = prod.product_identity?.product_family?.toLowerCase() || '';
        
        // Check if this is an accessory for the same family
        const isRelated = (family === searchFamily) || 
                          name.includes(searchFamily) ||
                          name.includes(familyFromName);
        
        if (!isRelated) continue;
        
        // Check if it's an accessory type
        const isAccessory = category.includes('accessor') ||
                           name.includes('cushion') ||
                           name.includes('cover') ||
                           name.includes('replacement') ||
                           name.includes('parasol') ||
                           name.includes('storage');
        
        if (!isAccessory) continue;
        
        // Filter by specific accessory type if requested
        if (accessoryType) {
            const typeMatch = name.includes(accessoryType.toLowerCase());
            if (!typeMatch) continue;
        }
        
        // Check stock
        const stock = getProductStock(sku);
        if (stock <= 0) continue;
        
        accessories.push({
            sku: sku,
            name: prod.product_identity?.product_name,
            type: name.includes('cushion') ? 'cushion' : 
                  name.includes('cover') ? 'cover' : 'accessory',
            price: prod.product_identity?.price_gbp
        });
        
        console.log(`   âœ… Found accessory: ${sku}`);
    }
    
    return accessories;
}

// ============================================
// DIMENSION CARD RENDERING
// ============================================

async function renderDimensionCard(sku, options = {}) {
    const { showBoxDimensions = false } = options;
    
    const productData = productIndex.bySku[sku];
    if (!productData) {
        console.log(`âš Ã¯Â¸Â No product data for SKU: ${sku}`);
        return null;
    }
    
    const name = productData.product_identity?.product_name || 'Product';
    const dimensions = productData.specifications?.dimensions_cm;
    const configurable = productData.specifications?.configurable_sides;
    
    // Get product URL (same logic as renderProductCard)
    const shopifyData = await getCachedShopifyData(sku);
    const productUrl = shopifyData?.url || `https://www.mint-outdoor.com/products/${sku.toLowerCase().replace(/\s+/g, '-')}`;
    
    // Check if dimensions are available
    const width = dimensions?.width;
    const depth = dimensions?.depth;
    const length = dimensions?.length || dimensions?.height; // Support both field names
    
    const hasDimensions = width && depth && (length || dimensions?.height);
    
    if (!hasDimensions) {
        // Missing dimensions - provide helpful fallback
        console.log(`ðŸ“ Missing dimensions for ${sku}`);
        return {
            type: 'dimension_missing',
            card: null,
            fallbackMessage: `I don't have the exact footprint sizes for the ${name} to hand, but we usually have detailed dimension diagrams on the product page here if you'd like to check:\n\n<a href="${productUrl}" target="_blank" style="color:#2E6041; text-decoration:underline;">â€” View ${name} â†’</a>\n\nOtherwise, please give me your email and I'll have our customer service manager get back to you within today or latest first thing tomorrow.`,
            productUrl: productUrl,
            productName: name,
            sku: sku
        };
    }
    
    // Build dimension card
    let card = `\nðŸ“ **${name} - Dimensions**\n\n`;
    card += `**Footprint:**\n`;
    card += `= Width: ${width}cm\n`;
    card += `= Depth: ${depth}cm\n`;
    
    // Use "Length" label for customer-facing (even if field is called height)
    if (length) {
        card += `= Length: ${length}cm\n`;
    }
    
    // Configurable sides messaging
    if (configurable && configurable !== 'N/A' && configurable !== '') {
        card += `\n**Configuration:** This set can be arranged as left or right-hand facing - perfect for fitting your specific space layout!\n`;
    }
    
    card += `\n<a href="${productUrl}" target="_blank" style="color:#2E6041; text-decoration:underline;">â€” View detailed dimension diagram â†’</a>\n`;
    
    // Box dimensions - only if explicitly requested
    if (showBoxDimensions) {
        const boxCard = renderBoxDimensionCard(sku, productData, productUrl);
        if (boxCard) {
            card += boxCard;
        }
    }
    
    return {
        type: 'dimension_card',
        card: card,
        productUrl: productUrl,
        productName: name,
        sku: sku,
        dimensions: {
            width: width,
            depth: depth,
            length: length
        }
    };
}

// ============================================
// BOX DIMENSION CARD RENDERING
// ============================================

function renderBoxDimensionCard(sku, productData, productUrl) {
    const components = productData.logistics_and_inventory?.components;
    
    if (!components || components.length === 0) {
        return `\nðŸ“¦ **Delivery Boxes:** Contact us for box dimensions - we'll measure and confirm before delivery.\n`;
    }
    
    // Check if any boxes have dimensions
    const boxesWithDimensions = components.filter(c => 
        c.box_dimensions_cm?.length || c.box_dimensions_cm?.width || c.box_dimensions_cm?.height
    );
    
    if (boxesWithDimensions.length === 0) {
        return `\nðŸ“¦ **Delivery Boxes:** This set arrives in ${components.length} box${components.length > 1 ? 'es' : ''}. Contact us for exact box dimensions.\n`;
    }
    
    let boxCard = `\nðŸ“¦ **Delivery Boxes:**\n`;
    boxCard += `This set arrives in ${components.length} box${components.length > 1 ? 'es' : ''}:\n\n`;
    
    const productFamily = productData.product_identity?.product_family?.toLowerCase() || '';
    const productName = productData.product_identity?.product_name?.toLowerCase() || '';
    let hasNameMismatch = false;
    
    components.forEach((box, index) => {
        const dims = box.box_dimensions_cm;
        const boxSku = box.component_sku || '';
        
        // Check for name mismatch (e.g., Palma product has FARO box codes)
        const boxFamily = boxSku.split('-')[0]?.toLowerCase() || '';
        if (boxFamily && productFamily && boxFamily !== productFamily && !productName.includes(boxFamily)) {
            hasNameMismatch = true;
        }
        
        if (dims?.length && dims?.width && dims?.height) {
            boxCard += `**Box ${index + 1}:** ${dims.length}cm Ã— ${dims.width}cm Ã— ${dims.height}cm\n`;
        } else {
            boxCard += `**Box ${index + 1}:** Dimensions not available\n`;
        }
    });
    
    // Add reassurance if box names don't match product name
    if (hasNameMismatch) {
        boxCard += `\n*Note: Your delivery boxes will be labelled with our internal stock code - this is the same product, just our warehouse reference. Don't worry, you're getting the correct set!*\n`;
    }
    
    return boxCard;
}

// ============================================
// SPACE FIT CHECKER - Filter products by dimensions
// ============================================

function filterProductsBySpace(products, maxWidth, maxLength) {
    console.log(`ðŸ“ Filtering for space: ${maxWidth}cm Ã— ${maxLength}cm`);
    
    const fitting = products.filter(p => {
        const product = productIndex.bySku[p.sku || p];
        if (!product) return false;
        
        const dims = product.specifications?.dimensions_cm;
        if (!dims) return true; // Include if no dimensions (can't confirm)
        
        const width = parseInt(dims.width) || 0;
        const length = parseInt(dims.length) || parseInt(dims.height) || 0;
        const depth = parseInt(dims.depth) || 0;
        
        // Check if product fits (either orientation)
        const fitsNormal = width <= maxWidth && (length || depth) <= maxLength;
        const fitsRotated = width <= maxLength && (length || depth) <= maxWidth;
        
        const fits = fitsNormal || fitsRotated;
        
        if (fits) {
            console.log(`   âœ… ${p.sku || p} fits (${width}Ã—${length || depth}cm)`);
        } else {
            console.log(`   =ÂÅ’ ${p.sku || p} too large (${width}Ã—${length || depth}cm)`);
        }
        
        return fits;
    });
    
    console.log(`ðŸ“ ${fitting.length} of ${products.length} products fit the space`);
    return fitting;
}


// ============================================
// SERVER-SIDE PRODUCT CARD RENDERING
// ============================================

async function renderProductCard(sku, options = {}) {
    const { showBundleHint = false, personalisation = '' } = options;
    
    const productData = productIndex.bySku[sku];
    if (!productData) {
        console.log(`âš Ã¯Â¸Â No product data for SKU: ${sku}`);
        return null;
    }
    
    // Get live Shopify data
    const shopifyData = await getCachedShopifyData(sku);
    
    // Determine price - prefer Shopify, fallback to local
    const price = shopifyData?.price || 
                  parseFloat(productData.product_identity?.price_gbp) || 0;
    
    // Determine stock
    const stock = shopifyData?.stock ?? getProductStock(sku);
    
    // Double-check stock
    if (stock <= 0) {
        console.log(`âš Ã¯Â¸Â ${sku} out of stock at render time`);
        return null;
    }
    
    const name = productData.product_identity?.product_name || 'Product';
    const imageUrl = productData.product_identity?.image_url || '';
    const productUrl = shopifyData?.url || `https://www.mint-outdoor.com/search?q=${sku}`;
    
    // Extract REAL features from materials
    const features = [];
    const warranties = [];
    
    if (productData.materials_and_care) {
        productData.materials_and_care.forEach(mat => {
            if (mat.warranty) {
                warranties.push(`${mat.name}: ${mat.warranty}`);
            }
            if (mat.pros) {
                const firstPro = mat.pros.split(',')[0].trim();
                if (firstPro && !features.includes(firstPro)) {
                    features.push(firstPro);
                }
            }
        });
    }
    
    // Add specs
    if (productData.specifications?.seats) {
        features.unshift(`Seats ${productData.specifications.seats} people`);
    }
    
    // Stock message - v15.0: with pre-order support
    const stockStatus = getStockStatus(sku);
    let stockMessage = '';
    if (stockStatus.status === 'pre_order') {
        stockMessage = stockStatus.message;
    } else if (stock <= 5) {
        stockMessage = `Only ${stock} left!`;
    } else if (stock <= 20) {
        stockMessage = `Low stock - ${stock} remaining`;
    } else {
        stockMessage = `In stock`;
    }
    
    // Build card
    let card = `\n**${name}**\n`;
    
    if (imageUrl) {
        card += `<a href="${productUrl}" target="_blank"><img src="${imageUrl}" alt="${name}" style="max-width:100%; border-radius:8px; margin:8px 0; cursor:pointer;"></a>\n\n`;
    }
    
    if (personalisation) {
        card += `âœ¨ *${personalisation}*\n\n`;
    }
    
    if (features.length > 0) {
        card += `**Why customers love this:**\n`;
        features.slice(0, 3).forEach(f => {
            card += `= ${f}\n`;
        });
    }
    
    if (warranties.length > 0) {
        card += `\n**Warranty:** ${warranties[0]}\n`;
    }
    
    card += `\n**Price:** Â£${price.toFixed(2)}\n`;
    card += `**Stock:** ${stockMessage}\n\n`;
    card += `<a href="${productUrl}" target="_blank" style="display:inline-block; padding:10px 20px; background:#2E6041; color:white; text-decoration:none; border-radius:5px;">View Product â†’</a>\n`;
    
    if (showBundleHint && productData.related_products?.matching_cover_sku) {
        card += `\nðŸŽ *Matching cover available - ask about our 20% bundle discount!*\n`;
    }
    
    return card;
}

async function renderMultipleProducts(skus, personalisation = '') {
    const cards = [];
    
    for (let i = 0; i < skus.length; i++) {
        const card = await renderProductCard(skus[i], {
            showBundleHint: (i === 0),
            personalisation: (i === 0) ? personalisation : ''
        });
        
        if (card) {
            cards.push(card);
        }
    }
    
    return cards;
}

// ============================================
// AI SYSTEM PROMPT
// ============================================

function buildSystemPrompt(sessionState) {
    // Build concise context summary
    const ctx = sessionState.established || {};
    const contextParts = [];
    if (ctx.furnitureType) contextParts.push(`Looking for: ${ctx.furnitureType} furniture`);
    if (ctx.seatCount) contextParts.push(`Seats needed: ${ctx.seatCount}+`);
    if (ctx.material) contextParts.push(`Material: ${ctx.material}`);
    
    const contextSummary = contextParts.length > 0 
        ? contextParts.join(' | ') 
        : "New customer - no preferences established yet";
    
    // Track commercial state
    const commercial = sessionState.commercial || {};
    const commercialState = [];
    if (commercial.productsShown?.length > 0) {
        commercialState.push(`Products shown: ${commercial.productsShown.length}`);
    }
    if (commercial.sentiment === 'price_concerned') {
        commercialState.push("âš Ã¯Â¸Â Customer is price-sensitive - NO UPSELLS");
    }
    if (commercial.bundleDeclined) {
        commercialState.push("âš Ã¯Â¸Â Bundle declined - don't offer again");
    }
    
    return `You are Gwen, a friendly sales assistant for MINT Outdoor furniture. You help customers find perfect outdoor furniture.

=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â
CURRENT CUSTOMER CONTEXT
=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â
${contextSummary}
${commercialState.length > 0 ? '\nCommercial notes: ' + commercialState.join(' | ') : ''}
=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â

YOUR CORE RULES:
1. REMEMBER what customer already told you - don't ask again
2. ANSWER direct questions FIRST, then ask follow-ups
3. When showing products, output SKUs only - server renders the cards
4. Be warm and helpful, never say "no" or "unfortunately"
5. NEVER write URLs or links in your response - the server adds all links automatically
6. NEVER invent product information - if you don't have data, ask for clarification
7. When customer asks for a SPECIFIC product by name (e.g. "palma set"), show it IMMEDIATELY - don't ask qualifying questions
8. ALWAYS suggest a protective cover or bundle when showing furniture - this is our key upsell

CRITICAL - URLS AND LINKS:
- You CANNOT and MUST NOT write any URLs or hyperlinks
- All product links are added automatically by the server
- If you write a URL, it will be wrong and break the customer experience
- Instead of writing links, use intents: product_recommendation, dimension_query, initiate_checkout

WHEN TO SHOW PRODUCTS (use product_recommendation intent):
- Customer mentions a SPECIFIC product family name (palma, stockholm, marbella etc.) → Show IMMEDIATELY
- Customer mentions material (rattan, teak, aluminium) AND furniture type or size → Show products
- Customer asks to see options or alternatives → Show products
→ For named products, show immediately. For general queries, get 2+ pieces of qualifying info

WHEN NOT TO SHOW PRODUCTS:
- Customer says "I like it", "that's great", "perfect" â†’ They've chosen! Help them buy, don't show more
- Customer asks "how do I order" or "how to buy" â†’ Give checkout instructions, don't show products
- Customer says "yes" to your question â†’ Acknowledge and help them proceed, don't restart

WHEN CUSTOMER IS READY TO BUY:
If customer says: "I'll take it", "how do I order", "how to buy", "yes I want it", "let's do it"
â†’ Use the initiate_checkout tool OR give clear ordering instructions:
   1. Tell them to click the View Product button
   2. Add to basket on our website
   3. Proceed to checkout
   4. Mention any bundle discount if applicable

WHEN CUSTOMER WANTS EMAIL QUOTE:
If customer provides email or asks you to email details:
â†’ Use the capture_email_for_quote tool
â†’ Confirm you'll send details within a few minutes

WHEN TO ASK QUESTIONS (use clarification intent):
- Only 1 piece of info known - ask for furniture type or size
- Never ask what they already told you
- NEVER ask "would you like these?" after they already said yes

RESPONDING TO SPECIFIC QUESTIONS:
- Price: "The [Product] is **Â£XXX**" - always include the pound amount
- Stock: "Yes, it's in stock with 3-5 day delivery"
- Warranty: "We offer 1-year guarantee plus extended material warranties"
- Dimensions: Use the get_product_dimensions tool to get exact sizes
- Box/Delivery size: Use get_product_dimensions with includeBoxDimensions=true
- Will it fit: Use get_product_dimensions, then confirm if it fits their space
- Eco questions: "Our teak is from sustainable plantations, aluminium is 100% recyclable"
- Commercial/B2B: "We work with businesses - contact sales@mint-outdoor.com for volume pricing"

QUALITY, TESTING & WEIGHT QUESTIONS (EN-581):
All Mint Outdoor products are tested to European safety standards. When customers ask about quality, strength, durability or testing:
- Use the en581Info object for authoritative answers
- Always mention "independently tested to European safety standards" in plain English
- Add "(the official testing standard is called EN-581 if you wanted to research that yourself)" for substance
- For WEIGHT LIMIT questions: Our furniture is tested for up to 110kg (17 stone 4 lbs)
- If customer needs HIGHER weight capacity, offer to connect with customer service for specialist options
- For STABILITY questions: Explain furniture is tested for tipping in all directions
- For DURABILITY questions: Explain 25,000 cycle testing simulating years of use
- For SAFETY questions: Mention smooth edges, no finger-trap hazards, secure mechanisms

EXISTING CUSTOMER VS FRUSTRATED PROSPECT - CRITICAL:
ROUTE A - EXISTING CUSTOMER (has order evidence):
If customer mentions: my order, my delivery, refund, return, order number, tracking, arrived damaged, wrong item sent, not delivered:
→ Direct them to Order Helpdesk (the server handles this automatically)
→ EXCEPTION: If they want to BUY MORE, help them with that

ROUTE B - FRUSTRATED PROSPECT (no order evidence):
If customer is frustrated/annoyed but has NOT mentioned any order:
→ They are a PROSPECT frustrated with the chat experience
→ Offer to connect them with customer service (ask for email)
→ Do NOT send to Order Helpdesk

KEY SIGNALS:
- "I am not a customer" / "not an existing customer" → ALWAYS treat as prospect
- "my order" / "refund" / "tracking" → ALWAYS treat as existing customer
- "annoying" / "frustrated" ALONE → Treat as frustrated prospect
NEVER ask "what furniture are you looking for" when someone is frustrated!

PRODUCT NAME RECOGNITION:
When customer mentions a product family name (Palma, Stockholm, Marbella, etc.):
- "[name] set" or "[name] dining" → Show FURNITURE from that family
- "[name] cover" → Show COVER for that family
- "[name] cushions" → Show REPLACEMENT CUSHIONS for that family
- "[name]" alone → Prioritize furniture, but mention covers are available
The server handles family routing - just search with the product name.

UPSELLING - ALWAYS DO THIS:
After showing any furniture set:
1. FIRST mention: "A matching protective cover is available - extends lifespan by 3-5 years!"
2. SECOND mention (if they show interest): Give the bundle price with 20% discount
3. If they ask about covers OR storage: Show the matching cover and cushion box
This is critical for business - every furniture recommendation should include a cover mention.

WHEN YOU CANNOT HELP OR CUSTOMER WANTS HUMAN SUPPORT:
If customer asks "how do I contact support", "speak to someone", "talk to a person", "customer service", 
OR if you cannot answer their question, OR if they're frustrated:
1. ALWAYS ask for their email address first
2. Then use request_human_handoff tool with their email and reason
3. The conversation will be emailed to our customer service team
4. Confirm: "I've passed your details to our team - they'll email you within a few hours"
5. NEVER say "I can't help" without offering to connect them with support

IMPORTANT: When chatbot cannot fulfill a request (e.g., product not available, question you can't answer):
- DO NOT give generic responses about "warranty info" or "delivery details"
- INSTEAD, immediately offer to connect with customer service
- Ask: "Let me connect you with our customer service team who can help. What's your email address?"

ACCESSORY QUERIES:
When customer asks about replacement cushions, covers, or accessories for a specific product:
1. Use find_accessories tool with the product name and accessory type
2. Show the main product AND available accessories
3. If no accessories found, offer to connect with customer service

DIMENSION QUERIES - IMPORTANT:
When customer asks "how big is...", "what size...", "dimensions of...", "will it fit...", "measurements":
1. Use get_product_dimensions tool with the product name
2. If dimensions found, output intent: "dimension_query" with the response
3. If product not found, ask customer to clarify which product they mean

=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â
OUTPUT FORMAT - ALWAYS VALID JSON
=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â

For conversation only (no products):
{
    "intent": "greeting" | "clarification" | "question_answer",
    "response_text": "Your friendly response here"
}

For showing products:
{
    "intent": "product_recommendation",
    "intro_copy": "Brief intro (1 sentence)",
    "selected_skus": ["SKU-1", "SKU-2"],
    "personalisation": "Brief personalisation",
    "closing_copy": "Which style catches your eye?"
}

For dimension queries:
{
    "intent": "dimension_query",
    "product_sku": "SKU-HERE",
    "include_box_dimensions": false,
    "response_text": "Optional intro text before dimension card"
}

=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â
AVAILABLE PRODUCT SKUs (only use these):
${sessionState.availableSkus?.length > 0 
    ? sessionState.availableSkus.join(', ') 
    : 'Call search_products first to find products'}
=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â

Remember: Output ONLY valid JSON. No markdown, no code blocks, just the JSON object.`;
}

// ============================================
// AI TOOLS
// ============================================

const aiTools = [
    {
        type: "function",
        function: {
            name: "search_products",
            description: "Search for products. Only call this when you have enough information from the customer (furniture type, approximate size/seats, optional material preference).",
            parameters: {
                type: "object",
                properties: {
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
                    productName: {
                        type: "string",
                        description: "Specific product name to search"
                    },
                    productFamily: {
                        type: "string",
                        description: "Product family name if customer mentions one (e.g. palma, stockholm, marbella, lima, santorini, chesterton, kiki, rose, bridgetown, sola, havana, barcelona)"
                    }
                }
            }
        }
    },
    {
        type: "function", 
        function: {
            name: "get_material_info",
            description: "Get detailed information about a material type for answering customer questions",
            parameters: {
                type: "object",
                properties: {
                    material: {
                        type: "string",
                        enum: ["teak", "aluminium", "rattan", "steel"],
                        description: "Material to get info about"
                    }
                },
                required: ["material"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "request_human_handoff",
            description: "Request handoff to human support team when customer needs help you cannot provide, wants to speak to someone, asks how to contact support, or when you cannot fulfill their request. ALWAYS capture customer email first so support can respond.",
            parameters: {
                type: "object",
                properties: {
                    reason: {
                        type: "string",
                        description: "Detailed reason for handoff - include what customer wanted and why you couldn't help"
                    },
                    customerEmail: {
                        type: "string",
                        description: "Customer's email address - REQUIRED so support team can respond"
                    },
                    customerName: {
                        type: "string",
                        description: "Customer's name if provided"
                    }
                },
                required: ["reason", "customerEmail"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "capture_email_for_quote",
            description: "Capture customer email to send them a quote or product summary. Use when customer provides their email address or asks you to email them details.",
            parameters: {
                type: "object",
                properties: {
                    email: {
                        type: "string",
                        description: "Customer's email address"
                    },
                    productSkus: {
                        type: "array",
                        items: { type: "string" },
                        description: "SKUs of products to include in quote"
                    },
                    includeBundle: {
                        type: "boolean",
                        description: "Whether to include bundle pricing"
                    }
                },
                required: ["email"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "initiate_checkout",
            description: "Help customer proceed to checkout. Use when customer says they want to buy, order, purchase, or asks how to complete their order.",
            parameters: {
                type: "object",
                properties: {
                    productSku: {
                        type: "string",
                        description: "SKU of main product to purchase"
                    },
                    includeBundle: {
                        type: "boolean",
                        description: "Whether customer wants the bundle deal"
                    }
                },
                required: ["productSku"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_product_dimensions",
            description: "Get dimensions and footprint size of a specific product. Use when customer asks about size, dimensions, measurements, or whether a product will fit their space.",
            parameters: {
                type: "object",
                properties: {
                    productName: {
                        type: "string",
                        description: "Name of the product to get dimensions for (e.g., 'Marbella', 'Stockholm', 'Palma')"
                    },
                    productSku: {
                        type: "string",
                        description: "SKU of the product if known"
                    },
                    includeBoxDimensions: {
                        type: "boolean",
                        description: "Whether to include delivery box dimensions (only if customer asks about boxes, delivery size, or fitting through doors)"
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "find_accessories",
            description: "Find accessories (cushions, covers, replacement parts) for a specific product. Use when customer asks about spare cushions, replacement covers, or accessories for a product.",
            parameters: {
                type: "object",
                properties: {
                    productName: {
                        type: "string",
                        description: "Name of the main product (e.g., 'Palma Grey', 'Stockholm')"
                    },
                    productSku: {
                        type: "string",
                        description: "SKU of the main product if known"
                    },
                    accessoryType: {
                        type: "string",
                        enum: ["cushion", "cover", "parasol", "storage", "any"],
                        description: "Type of accessory to find"
                    }
                }
            }
        }
    }
];

// Material information
const materialInfo = {
    teak: {
        warranty: "5 years structural",
        maintenance: "Oil annually to keep golden colour, or let weather naturally to silver-grey",
        durability: "25+ years lifespan",
        pros: "Beautiful natural wood, extremely durable, naturally weather-resistant",
        cons: "Requires some maintenance, higher price point"
    },
    aluminium: {
        warranty: "10 years against corrosion",
        maintenance: "Virtually none - just wipe with soapy water",
        durability: "20+ years lifespan",
        pros: "Zero maintenance, rust-proof, lightweight, modern look",
        cons: "Can get hot in direct sun"
    },
    rattan: {
        warranty: "2 years structural and colour retention",
        maintenance: "Cover during harsh winter, otherwise maintenance-free",
        durability: "10-15 years with care",
        pros: "UV-tested to 2000 hours, comfortable, affordable",
        cons: "Synthetic material, should be covered in extreme weather"
    },
    steel: {
        warranty: "3 years against rust",
        maintenance: "Check for scratches annually, touch up if needed",
        durability: "15+ years",
        pros: "Very strong, often powder-coated for protection",
        cons: "Can rust if coating damaged"
    }
};

// ============================================
// EN-581 QUALITY & TESTING INFORMATION
// ============================================
// All Mint Outdoor products are tested to EN-581 European safety standard

const en581Info = {
    standard: {
        name: "BS EN 581",
        description: "The European safety standard specifically designed for outdoor furniture",
        analogy: "Think of it like an MOT for garden furniture - rigorous independent testing",
        customerFriendly: "All our furniture is independently tested to European safety standards (the official testing standard is called EN-581 if you wanted to research that yourself)"
    },
    weightLimit: {
        kg: 110,
        stones: "17 stone 4 lbs",
        response: "Our furniture is tested for persons weighing up to 110kg (approximately 17 stone 4 lbs) - this is the European standard. If you need furniture for higher weight capacity, I can connect you with our customer service team who can advise on specialist options."
    },
    testing: {
        domestic: {
            cycles: 25000,
            description: "25,000 durability cycles - simulating years of daily family use",
            timeToComplete: "4-5 days of continuous laboratory testing"
        },
        contract: {
            cycles: 50000,
            description: "50,000 durability cycles - for commercial/heavy use",
            timeToComplete: "8-9 days of continuous laboratory testing"
        }
    },
    whatsTested: {
        strength: "Heavy loads applied to seats, backrests, armrests and legs - must not crack, break or permanently bend",
        stability: "Tested for tipping in all directions - forward, backward and sideways",
        safety: "All edges checked for sharpness, gaps checked for finger-trap hazards, folding mechanisms tested",
        durability: "Thousands of sit-down/stand-up cycles simulating years of real use",
        weather: "UV resistance, temperature cycling, and moisture exposure testing"
    },
    customerQuestions: {
        quality: "All our furniture is independently tested to European safety standards, covering strength, stability, durability and safety (the official testing standard is called EN-581 if you wanted to research that yourself). Every piece goes through rigorous laboratory testing before we sell it.",
        strength: "Our furniture undergoes serious strength testing - heavy loads are applied to seats, backs, armrests and legs to ensure nothing cracks, breaks or bends. It's tested to handle the equivalent of someone sitting down firmly thousands of times (the official testing standard is called EN-581 if you wanted to research that yourself).",
        stability: "Stability is a key part of the safety testing. Every chair is tested for tipping - forward, backward and sideways - under load. If it tips over in any direction, it fails. So you can sit back with confidence (the official testing standard is called EN-581 if you wanted to research that yourself).",
        durability: "For home garden use, furniture must survive 25,000 durability cycles in the lab - that's simulating years of a family sitting down and getting up, day after day. It's like fast-forwarding through years of use in just a few days of testing (the official testing standard is called EN-581 if you wanted to research that yourself).",
        weatherResistance: "The testing includes UV exposure (simulating years of sun), temperature extremes, and moisture - checking for fading, cracking, warping and corrosion. Our materials are chosen specifically to handle the British climate (the official testing standard is called EN-581 if you wanted to research that yourself).",
        safetyFeatures: "Safety checks include ensuring all edges are smooth with no sharp corners, no gaps that could trap fingers, and that folding mechanisms are secure. It's common-sense safety, but independently verified (the official testing standard is called EN-581 if you wanted to research that yourself)."
    },
    materialPerformance: {
        teak: "Teak is a premium choice - naturally weather-resistant, insect-repellent, and can last 30+ years. It ages to a beautiful silver-grey or can be oiled to keep the golden colour.",
        aluminium: "Aluminium is virtually maintenance-free - it's rust-proof, lightweight, and the powder coating provides extra protection. Perfect for the British climate.",
        rattan: "Our PE rattan is UV-stabilised and tested to 2000 hours of UV exposure. Quality varies hugely in the market - ours is high-density polyethylene on aluminium frames for durability.",
        steel: "Steel provides excellent strength and weight (won't blow over in wind). Powder-coated for rust protection - just touch up any scratches promptly."
    }
};




// ============================================
// COMMERCE GOVERNANCE ENGINE
// ============================================

const COMMERCE_RULES = {
    bundle: {
        maxOffersPerSession: 3,
        discountPercent: 20,
        stopAfterDecline: true,
        firstOfferType: 'soft', // 'soft' = just mention, 'detailed' = full pricing
        requireInterestForDetailed: true
    },
    upsell: {
        maxPerSession: 2,
        maxPriceIncrease: 0.5, // 50%
        requirePositiveSignal: true,
        stopIfPriceConcerned: true,
        stopAfterDecline: true
    },
    crossSell: {
        priority: ['cover', 'cushion_box', 'replacement_cushions', 'assembly'],
        maxPerProduct: 2,
        assemblyPrice: 99.95
    }
};

function buildStateSummary(session) {
    const ctx = session.context;
    const commercial = session.commercial;
    
    let summary = "=== CONVERSATION STATE ===\n";
    
    // Customer preferences
    if (ctx.material || ctx.furnitureType || ctx.seatCount) {
        summary += "Customer wants: ";
        const parts = [];
        if (ctx.material) parts.push(ctx.material);
        if (ctx.furnitureType) parts.push(ctx.furnitureType);
        if (ctx.seatCount) parts.push(`${ctx.seatCount}+ seats`);
        summary += parts.join(', ') + "\n";
    }
    
    // Products shown
    if (commercial.productsShown.length > 0) {
        summary += `Products shown: ${commercial.productsShown.slice(-5).join(', ')}\n`;
    }
    
    // Commercial state
    if (commercial.sentiment !== 'neutral') {
        summary += `Customer sentiment: ${commercial.sentiment}\n`;
    }
    if (commercial.bundlesOffered > 0) {
        summary += `Bundles offered: ${commercial.bundlesOffered}/3\n`;
    }
    
    return summary;
}

function detectCustomerSentiment(message) {
    const msgLower = message.toLowerCase();
    
    // Price concern signals
    const priceConcernWords = ['expensive', 'cost', 'budget', 'afford', 'cheaper', 'price too', 'too much', 'pricey', 'can\'t afford'];
    const isPriceConcerned = priceConcernWords.some(word => msgLower.includes(word));
    
    // Positive signals - customer likes what they see
    const positiveWords = ['love', 'great', 'perfect', 'excellent', 'interested', 'like', 'looks great', 'beautiful', 'amazing', 'fantastic', 'brilliant', 'lovely', 'really like', 'i like'];
    const isPositive = positiveWords.some(word => msgLower.includes(word));
    
    // Strong positive - customer has chosen
    const strongPositiveWords = ['i\'ll take', 'i will take', 'that\'s the one', 'decided', 'go with', 'choose', 'chosen', 'want this', 'want that', 'this one please', 'perfect for me'];
    const isStrongPositive = strongPositiveWords.some(word => msgLower.includes(word));
    
    // Decline signals
    const declineWords = ['no thanks', 'not interested', 'no thank you', 'just the', 'only want', 'don\'t need', 'pass on', 'not for me', 'don\'t like'];
    const isDecline = declineWords.some(word => msgLower.includes(word));
    
    // Bundle interest signals
    const bundleInterestWords = ['bundle', 'discount', 'together', 'package', 'deal', 'cover', 'protect', 'save'];
    const bundleInterest = bundleInterestWords.some(word => msgLower.includes(word));
    
    // ============================================
    // PURCHASE INTENT DETECTION - CRITICAL FOR CLOSING
    // ============================================
    
    // Ready to buy signals - customer wants to purchase NOW
    const readyToBuyWords = [
        'how do i order', 'how do i buy', 'how to order', 'how to buy',
        'where do i buy', 'where can i buy', 'where to buy',
        'add to cart', 'add to basket', 'checkout', 'check out',
        'purchase', 'buy now', 'buy it', 'buy this', 'take it',
        'i\'ll have', 'i will have', 'order this', 'order it',
        'ready to order', 'ready to buy', 'want to order', 'want to buy',
        'place an order', 'make an order', 'complete my order',
        'get the discount', 'apply the discount', 'use the discount',
        'proceed', 'go ahead', 'let\'s do it', 'sounds good let\'s go'
    ];
    const isReadyToBuy = readyToBuyWords.some(word => msgLower.includes(word));
    
    // Confirmation signals - customer saying yes to offers
    const confirmationWords = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'please', 'go ahead', 'sounds good', 'that\'s great', 'that works', 'absolutely'];
    const isConfirmation = confirmationWords.some(word => {
        // Check if it's a standalone confirmation or at the start
        const regex = new RegExp(`(^|\\s)${word}($|\\s|,|\\.|!)`, 'i');
        return regex.test(msgLower);
    });
    
    // Questions about buying process
    const buyProcessWords = ['delivery', 'shipping', 'payment', 'pay', 'card', 'checkout', 'when will it arrive', 'how long', 'return policy', 'warranty'];
    const isAskingAboutBuying = buyProcessWords.some(word => msgLower.includes(word));
    
    // Calculate purchase intent level (0-3)
    let purchaseIntentLevel = 0;
    if (isAskingAboutBuying) purchaseIntentLevel = 1;
    if (isStrongPositive || isConfirmation) purchaseIntentLevel = 2;
    if (isReadyToBuy) purchaseIntentLevel = 3;
    
    return {
        priceConcerned: isPriceConcerned,
        positive: isPositive || isStrongPositive,
        strongPositive: isStrongPositive,
        decline: isDecline,
        bundleInterest: bundleInterest,
        readyToBuy: isReadyToBuy,
        confirmation: isConfirmation,
        askingAboutBuying: isAskingAboutBuying,
        purchaseIntentLevel: purchaseIntentLevel
    };
}

function checkBundleEligibility(session) {
    const rules = COMMERCE_RULES.bundle;
    const commercial = session.commercial;
    
    // Rule 1: Max offers per session
    if (commercial.bundlesOffered >= rules.maxOffersPerSession) {
        return { eligible: false, reason: 'max_offers_reached' };
    }
    
    // Rule 2: Stop after decline
    if (rules.stopAfterDecline && commercial.bundleDeclined) {
        return { eligible: false, reason: 'customer_declined' };
    }
    
    // Rule 3: Must have shown a product first
    if (commercial.productsShown.length === 0) {
        return { eligible: false, reason: 'no_products_shown' };
    }
    
    return { 
        eligible: true,
        offerType: commercial.bundleInterestShown ? 'detailed' : 'soft'
    };
}

function checkUpsellEligibility(session, targetPrice, currentPrice) {
    const rules = COMMERCE_RULES.upsell;
    const commercial = session.commercial;
    
    // Rule 1: Not first message
    if (session.messageCount <= 2) {
        return { eligible: false, reason: 'too_early' };
    }
    
    // Rule 2: Positive signal required
    if (rules.requirePositiveSignal && !commercial.positiveSignalReceived) {
        return { eligible: false, reason: 'no_positive_signal' };
    }
    
    // Rule 3: Max per session
    if (commercial.upsellsOffered >= rules.maxPerSession) {
        return { eligible: false, reason: 'max_reached' };
    }
    
    // Rule 4: Customer not price-concerned
    if (rules.stopIfPriceConcerned && commercial.sentiment === 'price_concerned') {
        return { eligible: false, reason: 'price_sensitive' };
    }
    
    // Rule 5: Price increase limit
    if (currentPrice && targetPrice) {
        const increase = (targetPrice - currentPrice) / currentPrice;
        if (increase > rules.maxPriceIncrease) {
            return { eligible: false, reason: 'price_jump_too_high' };
        }
    }
    
    // Rule 6: Stop after decline
    if (rules.stopAfterDecline && commercial.upsellDeclined) {
        return { eligible: false, reason: 'customer_declined' };
    }
    
    return { eligible: true };
}

function getBundleForProduct(sku) {
    // Find bundles that include this product
    const matchingBundles = [];
    
    for (const item of bundleItems) {
        if (item.product_sku === sku) {
            const bundle = bundleSuggestions.find(b => b.bundle_id === item.bundle_id);
            if (bundle) {
                const bundleProducts = bundleItems.filter(bi => bi.bundle_id === item.bundle_id);
                matchingBundles.push({
                    ...bundle,
                    products: bundleProducts
                });
            }
        }
    }
    
    return matchingBundles;
}

function getCrossSellSuggestions(sku, session) {
    const product = productIndex.bySku[sku];
    if (!product) return [];
    
    const suggestions = [];
    const alreadyShown = session.commercial.crossSellsShown || [];
    
    // Priority 1: Matching cover
    if (product.related_products?.matching_cover_sku) {
        const coverSku = product.related_products.matching_cover_sku;
        if (!alreadyShown.includes(coverSku) && isInStock(coverSku)) {
            suggestions.push({
                type: 'cover',
                sku: coverSku,
                priority: 1,
                pitch: "Protect your investment with a matching cover - extends lifespan by 3-5 years!"
            });
        }
    }
    
    // Priority 2: Cushion box (check product name/category)
    const materialType = product.description_and_category?.material_type?.toLowerCase();
    if (materialType === 'rattan') {
        // Find matching cushion box
        const cushionBoxSku = `${product.product_identity?.product_family || 'GENERAL'}-CUSHION-BOX`;
        if (productIndex.bySku[cushionBoxSku] && isInStock(cushionBoxSku)) {
            suggestions.push({
                type: 'cushion_box',
                sku: cushionBoxSku,
                priority: 2,
                pitch: "Keep your cushions fresh and dry with a matching cushion storage box!"
            });
        }
    }
    
    // Priority 4: Assembly service
    if (product.specifications?.assembly?.required) {
        suggestions.push({
            type: 'assembly',
            sku: 'ASSEMBLY-SERVICE',
            priority: 4,
            price: COMMERCE_RULES.crossSell.assemblyPrice,
            pitch: `Save time with our professional assembly service - just Â£${COMMERCE_RULES.crossSell.assemblyPrice}!`
        });
    }
    
    // Sort by priority
    return suggestions.sort((a, b) => a.priority - b.priority);
}

// ============================================
// CLOSING FLOW - CONVERT READY BUYERS
// ============================================

function buildClosingResponse(session, sentiment) {
    const lastProducts = session.commercial.productsShown.slice(-3);
    const mainProductSku = lastProducts[0];
    const mainProduct = mainProductSku ? productIndex.bySku[mainProductSku] : null;
    
    if (!mainProduct) {
        return {
            type: 'soft_close',
            text: "I'd love to help you complete your purchase! Which product caught your eye? I can guide you through the ordering process."
        };
    }
    
    const productName = mainProduct.product_identity?.product_name || 'your selected product';
    const productUrl = `https://www.mint-outdoor.com/products/${mainProductSku.toLowerCase()}`;
    const price = parseFloat(mainProduct.product_identity?.price_gbp) || 0;
    
    // Check if there's a bundle available
    const bundles = getBundleForProduct(mainProductSku);
    const hasBundle = bundles.length > 0;
    
    if (hasBundle && session.commercial.bundleInterestShown) {
        // Customer showed interest in bundle - give bundle checkout flow
        const bundle = bundles[0];
        let bundleTotal = 0;
        const bundleProductNames = [];
        
        for (const item of bundle.products) {
            const prod = productIndex.bySku[item.product_sku];
            if (prod) {
                const itemPrice = parseFloat(prod.product_identity?.price_gbp) || 0;
                bundleTotal += itemPrice * item.product_qty;
                bundleProductNames.push(prod.product_identity?.product_name);
            }
        }
        
        const discount = bundleTotal * (COMMERCE_RULES.bundle.discountPercent / 100);
        const finalPrice = bundleTotal - discount;
        
        return {
            type: 'bundle_checkout',
            intent: 'checkout_flow',
            text: `Brilliant choice! Here's how to get your bundle with the ${COMMERCE_RULES.bundle.discountPercent}% discount:\n\n` +
                  `**Your Bundle:**\n` +
                  bundleProductNames.map(n => `âœ” ${n}`).join('\n') + `\n\n` +
                  `**Bundle Price: Â£${finalPrice.toFixed(2)}** ~~Â£${bundleTotal.toFixed(2)}~~\n` +
                  `*You save: Â£${discount.toFixed(2)}*\n\n` +
                  `**To order:**\n` +
                  `1Ã¯Â¸Â=Æ’Â£ Click the link below to view the main product\n` +
                  `2Ã¯Â¸Â=Æ’Â£ Add it to your basket\n` +
                  `3Ã¯Â¸Â=Æ’Â£ The matching accessories will be suggested at checkout\n` +
                  `4Ã¯Â¸Â=Æ’Â£ Your ${COMMERCE_RULES.bundle.discountPercent}% bundle discount applies automatically!\n\n` +
                  `<a href="${productUrl}" target="_blank" style="display:inline-block; padding:12px 24px; background:#2E6041; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">ORDER NOW â†’ Â£${finalPrice.toFixed(2)}</a>\n\n` +
                  `Or if you'd like me to email you this quote to review later, just let me know your email address and I'll send it with the discount locked in for 48 hours! ðŸ“§`,
            mainProduct: mainProductSku,
            bundlePrice: finalPrice,
            savingsAmount: discount
        };
    } else {
        // Standard product checkout flow
        return {
            type: 'product_checkout',
            intent: 'checkout_flow',
            text: `Excellent choice! The **${productName}** is one of our most popular sets.\n\n` +
                  `**Price: Â£${price.toFixed(2)}**\n` +
                  `âœ… In stock with 3-5 day delivery\n` +
                  `âœ… 1-year warranty included\n\n` +
                  `**To order:**\n` +
                  `Simply click the button below to add it to your basket and checkout:\n\n` +
                  `<a href="${productUrl}" target="_blank" style="display:inline-block; padding:12px 24px; background:#2E6041; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">ORDER NOW â†’ Â£${price.toFixed(2)}</a>\n\n` +
                  `Would you also like a protective cover? It extends the furniture's life by 3-5 years and you'll save ${COMMERCE_RULES.bundle.discountPercent}% when bought together! ðŸŽ`,
            mainProduct: mainProductSku,
            productPrice: price
        };
    }
}

function buildEmailCaptureResponse(session) {
    const lastProducts = session.commercial.productsShown.slice(-3);
    const mainProductSku = lastProducts[0];
    const mainProduct = mainProductSku ? productIndex.bySku[mainProductSku] : null;
    
    const productName = mainProduct?.product_identity?.product_name || 'your selected items';
    
    return {
        type: 'email_capture',
        intent: 'email_capture',
        text: `I'd be happy to email you a summary of ${productName} with all the details and your exclusive discount.\n\n` +
              `Just share your email address and I'll send:\n` +
              `ðŸ“‹ Product specifications and dimensions\n` +
              `ðŸ’° Your personalised quote with any bundle discounts\n` +
              `â€™ Discount locked in for 48 hours\n\n` +
              `What's the best email to send this to?`
    };
}

function getContextAwareClosingCopy(session, sentiment) {
    const commercial = session.commercial;
    
    // Customer has shown strong positive signals - don't ask if they like it!
    if (sentiment.strongPositive || commercial.positiveSignalReceived) {
        const options = [
            "Ready to order? Click the 'View Product' button above, or let me know if you have any final questions!",
            "Great choice! Click above to add it to your basket, or ask me anything else you'd like to know.",
            "Shall I help you complete your purchase? Just click the product link above to checkout.",
            "Click the button above to order, or let me know if you'd like more details on delivery and warranty."
        ];
        return options[Math.floor(Math.random() * options.length)];
    }
    
    // Customer asked about buying process - they're close to converting
    if (sentiment.askingAboutBuying) {
        return "Does this answer your question? When you're ready, just click the product link above to complete your order.";
    }
    
    // Customer is in discovery mode - standard closing
    if (commercial.productsShown.length <= 3) {
        return "Which of these catches your eye? I can tell you more about any of them.";
    }
    
    // Customer has seen multiple products - help them decide
    if (commercial.productsShown.length > 5) {
        return "You've seen a few options now! Would you like me to help you compare, or is there one that stands out?";
    }
    
    // Default
    return "Would any of these work for your space? Let me know if you'd like more details.";
}

function buildBundleOffer(session, mainProductSku, offerType) {
    const bundles = getBundleForProduct(mainProductSku);
    if (bundles.length === 0) return null;
    
    const bundle = bundles[0]; // Take first matching bundle
    const mainProduct = productIndex.bySku[mainProductSku];
    
    if (offerType === 'soft') {
        return {
            type: 'soft',
            text: `ðŸŽ *Great news! This comes with a matching protective cover bundle - save ${COMMERCE_RULES.bundle.discountPercent}% when you buy together. Would you like details?*`
        };
    } else {
        // Detailed pricing
        let totalOriginal = 0;
        let productDetails = [];
        
        for (const item of bundle.products) {
            const prod = productIndex.bySku[item.product_sku];
            if (prod) {
                const price = parseFloat(prod.product_identity?.price_gbp) || 0;
                totalOriginal += price * item.product_qty;
                productDetails.push(`- ${prod.product_identity?.product_name}: Â£${price.toFixed(2)}`);
            }
        }
        
        const discount = totalOriginal * (COMMERCE_RULES.bundle.discountPercent / 100);
        const bundlePrice = totalOriginal - discount;
        
        return {
            type: 'detailed',
            text: `ðŸŽ **${bundle.name} Bundle Deal**\n\n${productDetails.join('\n')}\n\n~~Original: Â£${totalOriginal.toFixed(2)}~~\n**Bundle Price: Â£${bundlePrice.toFixed(2)}**\n*You save: Â£${discount.toFixed(2)} (${COMMERCE_RULES.bundle.discountPercent}% off)*\n\nWant me to add this bundle to help you complete your purchase?`
        };
    }
}

// ============================================
// VALIDATE AI OUTPUT
// ============================================

function validateAIOutput(aiOutput, whitelist, sessionId) {
    if (!aiOutput || !aiOutput.intent) {
        console.log(`âš Ã¯Â¸Â [${sessionId}] Missing aiOutput or intent`);
        return null;
    }
    
    // For product recommendations, validate SKUs
    if (aiOutput.intent === 'product_recommendation' && aiOutput.selected_skus) {
        const validSkus = [];
        const invalidSkus = [];
        
        for (const sku of aiOutput.selected_skus) {
            if (whitelist.includes(sku)) {
                validSkus.push(sku);
            } else {
                invalidSkus.push(sku);
                console.log(`ðŸ›¡ï¸ [${sessionId}] BLOCKED: "${sku}" not in whitelist`);
            }
        }
        
        aiOutput.selected_skus = validSkus;
        
        if (invalidSkus.length > 0) {
            console.log(`ðŸ›¡ï¸ Whitelist was: [${whitelist.join(', ')}]`);
        }
    }
    
    return aiOutput;
}

// ============================================
// ASSEMBLE FINAL RESPONSE
// ============================================

async function assembleResponse(aiOutput, sessionId, session) {
    const intent = aiOutput.intent;
    
    // ============================================
    // HANDLE CHECKOUT FLOW RESPONSES
    // ============================================
    if (intent === 'checkout_flow') {
        return aiOutput.response_text || aiOutput.text || "Let me help you complete your purchase!";
    }
    
   if (intent === 'email_capture') {
        return aiOutput.response_text || aiOutput.text || "I'd be happy to email you the details!";
    }
    
    // Handle dimension queries
    if (intent === 'dimension_query') {
        const sku = aiOutput.product_sku;
        const includeBoxDimensions = aiOutput.include_box_dimensions || false;
        
        if (sku) {
            const dimensionResult = await renderDimensionCard(sku, {
                showBoxDimensions: includeBoxDimensions
            });
            
            if (dimensionResult) {
                let response = '';
                
                // Add intro text if provided
                if (aiOutput.response_text) {
                    response += aiOutput.response_text + '\n';
                }
                
                if (dimensionResult.type === 'dimension_missing') {
                    response += dimensionResult.fallbackMessage;
                } else {
                    response += dimensionResult.card;
                    
                    // Add helpful follow-up
                    response += '\nWould this work for your space? Let me know if you have any other questions!';
                }
                
                return response;
            }
        }
        
        // Fallback if SKU not found
        return aiOutput.response_text || "I'd be happy to help with dimensions. Which product are you interested in?";
    }
    
    // For non-product intents, use AI's response text directly
    if (intent !== 'product_recommendation') {
        return aiOutput.response_text || "I'm here to help! What would you like to know about our outdoor furniture?";
    }
    
    // For product recommendations, render cards server-side
    const parts = [];
    
    if (aiOutput.intro_copy) {
        parts.push(aiOutput.intro_copy);
    }
    
    let mainProductSku = null;
    
    if (aiOutput.selected_skus && aiOutput.selected_skus.length > 0) {
        mainProductSku = aiOutput.selected_skus[0];
        
        const cards = await renderMultipleProducts(
            aiOutput.selected_skus,
            aiOutput.personalisation || ''
        );
        
        if (cards.length > 0) {
            parts.push('');
            parts.push(cards.join('\n---\n'));
        } else {
            parts.push("\nI'm sorry, but the products I wanted to show you aren't currently available. Let me find some alternatives - what's most important to you: material, size, or style?");
            return parts.join('\n');
        }
    }
    
    // ============================================
    // INTELLIGENT CROSS-SELL TIMING
    // Only cross-sell AFTER positive signals, not on first showing
    // ============================================
    
    if (mainProductSku && session) {
        const hasPositiveSignal = session.commercial.positiveSignalReceived;
        const messageCount = session.messageCount;
        const productsAlreadyShown = session.commercial.productsShown.length;
        
        // Check if we should offer a bundle
        const bundleEligibility = checkBundleEligibility(session);
        
        // Only show bundle offers if:
        // 1. Eligible AND
        // 2. (Customer showed positive signal OR this is at least their 3rd message OR they've seen products before)
        const shouldOfferBundle = bundleEligibility.eligible && 
            (hasPositiveSignal || messageCount >= 3 || productsAlreadyShown > 0);
        
        if (shouldOfferBundle) {
            const bundleOffer = buildBundleOffer(session, mainProductSku, bundleEligibility.offerType);
            
            if (bundleOffer) {
                parts.push('');
                parts.push(bundleOffer.text);
                session.commercial.bundlesOffered++;
                session.commercial.lastOfferType = 'bundle';
                console.log(`ðŸŽ Bundle offer added (${bundleEligibility.offerType}) - positive signal: ${hasPositiveSignal}`);
            }
        }
        
        // Cross-sell: Only if no bundle offered AND customer has shown interest
        if (!shouldOfferBundle && hasPositiveSignal) {
            const crossSells = getCrossSellSuggestions(mainProductSku, session);
            
            if (crossSells.length > 0 && session.commercial.crossSellsShown.length < 2) {
                const suggestion = crossSells[0];
                parts.push('');
                parts.push(`ðŸ’¡ *${suggestion.pitch}*`);
                session.commercial.crossSellsShown.push(suggestion.sku);
                console.log(`ðŸ’¡ Cross-sell suggested: ${suggestion.type}`);
            }
        }
    }
    
    // ============================================
    // CONTEXT-AWARE CLOSING COPY
    // Don't ask "would you like these?" if customer already said yes!
    // ============================================
    
    // Get the latest sentiment to determine closing copy
    const latestSentiment = session.commercial.latestSentiment || { positive: false };
    
    const closingCopy = getContextAwareClosingCopy(session, latestSentiment);
    parts.push('');
    parts.push(closingCopy);
    
    return parts.join('\n');
}

// ============================================
// MAIN CHAT ENDPOINT
// ============================================

app.post('/chat', async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        
        if (!message || !sessionId) {
            return res.status(400).json({ 
                response: 'Please provide a message and session ID.'
            });
        }
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`ðŸ“© [${sessionId}] "${message}"`);
        
        // Get or create session
        if (!sessions.has(sessionId)) {
            sessions.set(sessionId, {
                messageCount: 0,
                conversationHistory: [],
                currentWhitelist: [],
                context: {
                    furnitureType: null,
                    subType: null,
                    seatCount: null,
                    sizePreference: null,
                    material: null,
                    colour: null,
                    priceRange: null,
                    maxPrice: null,
                    minPrice: null,
                    queryType: null,
                    customerSpace: null,
                    // v15.0: Family tracking
                    requestedFamily: null,
                    requestedFamilyType: null
                },
               commercial: {
                    bundlesOffered: 0,
                    bundleDeclined: false,
                    upsellsOffered: 0,
                    upsellDeclined: false,
                    bundleInterestShown: false,
                    positiveSignalReceived: false,
                    strongPositiveReceived: false,
                    sentiment: 'neutral',
                    latestSentiment: null,
                    productsShown: [],
                    crossSellsShown: [],
                    lastProductPrice: null,
                    lastOfferType: null
                },
                escalationOffered: false,
                pendingEscalation: false,
                escalationReason: null,
                // Session exclusion tracking
                excludedCategories: [],
                excludedProductTypes: []
            });
        }
        
        const session = sessions.get(sessionId);
        session.messageCount++;
        
        // ============================================
        // COMPREHENSIVE CONTEXT EXTRACTION
        // ============================================
        const msgLower = message.toLowerCase();
        
        // ============================================
        // v15.0: SESSION EXCLUSION DETECTION
        // ============================================
        if (msgLower.includes('not the cover') || msgLower.includes('not a cover') || 
            msgLower.includes('not covers') || msgLower.includes("don't want cover") ||
            msgLower.includes('dont want cover') || msgLower.includes('no cover')) {
            if (!session.excludedCategories.includes('covers')) {
                session.excludedCategories.push('covers');
                console.log(`🚫 Exclusion added: covers`);
            }
        }
        
        if (msgLower.includes('not the cushion') || msgLower.includes('not cushions') ||
            msgLower.includes("don't want cushion") || msgLower.includes('dont want cushion')) {
            if (!session.excludedCategories.includes('cushions')) {
                session.excludedCategories.push('cushions');
                console.log(`🚫 Exclusion added: cushions`);
            }
        }
        
        if (msgLower.includes('not the box') || msgLower.includes('not a box') ||
            msgLower.includes("don't want box") || msgLower.includes('dont want box')) {
            if (!session.excludedCategories.includes('boxes')) {
                session.excludedCategories.push('boxes');
                console.log(`🚫 Exclusion added: boxes`);
            }
        }
        
        if (msgLower.includes('not accessor') || msgLower.includes('no accessor') ||
            msgLower.includes('just the furniture') || msgLower.includes('just the set')) {
            if (!session.excludedProductTypes.includes('accessories')) {
                session.excludedProductTypes.push('accessories');
                console.log(`🚫 Exclusion added: accessories`);
            }
        }
        
        // ============================================
        // v15.0: FAMILY + TYPE PARSING
        // ============================================
        const familyParse = parseFamilyAndType(message);
        if (familyParse.family) {
            session.context.requestedFamily = familyParse.family;
            session.context.requestedFamilyType = familyParse.requestedType;
            console.log(`🏷️ Session: family=${familyParse.family}, type=${familyParse.requestedType}`);
        }

        
        // ============================================
        // v15.0: PRIORITY ZERO - COMPLAINT ROUTING
        // ============================================
        // Distinguish between:
        // A) Existing customer with ORDER issue → Order Helpdesk
        // B) Frustrated PROSPECT (no order) → Sales escalation (help@)
        
        const orderEvidencePatterns = [
            'my order', 'my delivery', 'order number', 'tracking number', 'tracking',
            'refund', 'return', 'send back', 'sending back', 'money back',
            'arrived damaged', 'arrived broken', 'item arrived', 'package arrived',
            'wrong item sent', 'sent wrong', 'received wrong',
            'missing from order', 'missing from my', 'missing from the',
            'not delivered', 'not arrived', "hasn't arrived", 'hasnt arrived',
            "where is my order", "where's my order", 'wheres my order',
            'delivery issue', 'order issue', 'order problem',
            'already ordered', 'placed an order', 'bought from you', 'purchased from',
            'previous order', 'last order', 'recent order', 'my purchase',
            'existing order', 'outstanding order'
        ];
        
        const frustrationPatterns = [
            'complaint', 'complain', 'complaining',
            'not happy', 'unhappy', 'disappointed', 'disgusted', 'furious', 'angry',
            'annoying', 'annoyed', 'frustrated', 'frustrating',
            'terrible', 'rubbish', 'useless', 'waste of time', 'hopeless',
            'speak to manager', 'speak to supervisor', 'escalate',
            'trading standards', 'consumer rights', 'legal action'
        ];
        
        const notACustomerPatterns = [
            'i am not a customer', 'not a customer', 'not an existing customer',
            "haven't ordered", 'havent ordered', 'not ordered yet', "haven't bought",
            'havent bought', 'not bought yet', 'trying to buy', 'want to buy',
            'looking to buy', 'interested in buying', 'thinking of buying'
        ];
        
        const hasOrderEvidence = orderEvidencePatterns.some(p => msgLower.includes(p));
        const hasFrustration = frustrationPatterns.some(p => msgLower.includes(p));
        const isNotACustomer = notACustomerPatterns.some(p => msgLower.includes(p));
        const wantsToBuyMore = msgLower.includes('buy more') || msgLower.includes('order more') || 
                               msgLower.includes('another') || msgLower.includes('additional order') ||
                               msgLower.includes('new order') || msgLower.includes('want to buy');
        
        // ROUTE A: Clear order evidence (and not explicitly saying they're not a customer)
        if (hasOrderEvidence && !isNotACustomer && !wantsToBuyMore) {
            console.log(`🚨 EXISTING CUSTOMER ORDER ISSUE DETECTED: "${message}"`);
            
            const helpdeskUrl = 'https://mint-orderhelpdesk-bot-5c699086fbd7.herokuapp.com/';
            const complaintResponse = `I'm really sorry to hear you're having an issue with your order. For existing order enquiries, complaints, or issues with deliveries, our dedicated Order Helpdesk team can assist you straight away.\n\n**Please click here to speak with our Order Helpdesk:**\n<a href="${helpdeskUrl}" target="_blank" style="display:inline-block; padding:12px 24px; background:#dc3545; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">Go to Order Helpdesk →</a>\n\nThey have access to your order details and can resolve issues much faster than I can.\n\nIf you'd like to browse new products or make a new purchase, I'm happy to help with that here!`;
            
            session.conversationHistory.push({ role: 'user', content: message });
            session.conversationHistory.push({ role: 'assistant', content: complaintResponse });
            
            await logConversationMessage(sessionId, 'user', message, { sentiment: 'complaint' });
            await logConversationMessage(sessionId, 'assistant', complaintResponse, { intent: 'complaint_redirect' });
            
            return res.json({ response: complaintResponse, sessionId });
        }
        
        // ROUTE B: Frustration WITHOUT order evidence (or explicitly said "not a customer")
        if ((hasFrustration && !hasOrderEvidence) || (isNotACustomer && hasFrustration)) {
            console.log(`😤 FRUSTRATED PROSPECT DETECTED: "${message}"`);
            
            session.escalationOffered = true;
            session.escalationReason = isNotACustomer 
                ? 'Customer clarified they are a prospect, not existing customer' 
                : 'Frustrated prospect - needs human sales support';
            
            const frustrationResponse = `I'm really sorry for the frustration. Let me connect you with our customer service team who can help you properly.\n\nTo make sure they can get back to you quickly, could you please share your email address?`;
            
            session.conversationHistory.push({ role: 'user', content: message });
            session.conversationHistory.push({ role: 'assistant', content: frustrationResponse });
            session.pendingEscalation = true;
            
            await logConversationMessage(sessionId, 'user', message, { sentiment: 'frustrated_prospect' });
            await logConversationMessage(sessionId, 'assistant', frustrationResponse, { intent: 'sales_escalation_offer' });
            
            return res.json({ response: frustrationResponse, sessionId });
        }
        

        // ============================================
        // CHECK FOR ESCALATION ACCEPTANCE (PRIORITY FIRST!)
        // ============================================
        // If Gwen just offered to connect to customer service and customer said "yes"
        const affirmativePatterns = [
            'yes', 'yeah', 'yep', 'sure', 'please', 'ok', 'okay', 
            'go ahead', 'that would be great', 'that would be good',
            'yes please', 'please do', 'i would like that', 'sounds good'
        ];
        
        const isAffirmative = affirmativePatterns.some(p => {
            // Match whole word or phrase, not partial (e.g., "yes" not in "yesterday")
            const regex = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return regex.test(msgLower);
        });
        
        // Check if customer is accepting escalation offer
        if (session.escalationOffered && isAffirmative) {
            console.log(`ðŸš¨ Customer accepted escalation offer - proceeding with email capture`);
            session.pendingEscalation = true;
            session.escalationOffered = false; // Reset the offer flag
            
            // Check if they also provided an email in the same message
            const emailMatch = message.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
            if (emailMatch) {
                session.customerEmail = emailMatch[0];
                session.pendingEscalation = false;
                
                // Send escalation email
                const emailResult = await sendEscalationEmail(
                    session.customerEmail,
                    session.customerName || 'Not provided',
                    session.escalationReason || 'Customer requested human support',
                    session.conversationHistory || [],
                    session.commercial.productsShown || []
                );
                
                console.log(`ðŸ“§ ESCALATION EMAIL SENT (with affirmative): ${session.customerEmail}`);
                
                // Return escalation confirmation directly
                const confirmationResponse = `Perfect, thank you! I've sent your details and our conversation to our customer service team. They will email you at ${session.customerEmail} within a few hours (or first thing tomorrow if outside business hours).\n\nIs there anything else I can help with in the meantime?`;
                
                session.conversationHistory.push({ role: 'user', content: message });
                session.conversationHistory.push({ role: 'assistant', content: confirmationResponse });
                
                await logConversationMessage(sessionId, 'user', message, {});
                await logConversationMessage(sessionId, 'assistant', confirmationResponse, { intent: 'escalation_sent' });
                
                return res.json({ response: confirmationResponse, sessionId });
            } else {
                // No email provided - ask for it
                const emailRequestResponse = `I'd be happy to connect you with our customer service team who can help with this.\n\nTo make sure they can get back to you quickly, could you please share your email address? I'll pass on our conversation so they have all the context.`;
                
                session.conversationHistory.push({ role: 'user', content: message });
                session.conversationHistory.push({ role: 'assistant', content: emailRequestResponse });
                
                await logConversationMessage(sessionId, 'user', message, {});
                await logConversationMessage(sessionId, 'assistant', emailRequestResponse, { intent: 'email_capture_for_escalation' });
                
                return res.json({ response: emailRequestResponse, sessionId });
            }
        }
        
        // Check if customer is providing email after we asked for it (for escalation)
        if (session.pendingEscalation) {
            const emailMatch = message.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
            if (emailMatch) {
                session.customerEmail = emailMatch[0];
                session.pendingEscalation = false;
                
                // Send escalation email
                const emailResult = await sendEscalationEmail(
                    session.customerEmail,
                    session.customerName || 'Not provided',
                    session.escalationReason || 'Customer requested human support',
                    session.conversationHistory || [],
                    session.commercial.productsShown || []
                );
                
                console.log(`ðŸ“§ ESCALATION EMAIL SENT after email capture: ${session.customerEmail}`);
                
                const confirmationResponse = `Perfect, thank you! I've sent your details and our conversation to our customer service team. They will email you at ${session.customerEmail} within a few hours (or first thing tomorrow if outside business hours).\n\nIs there anything else I can help with in the meantime?`;
                
                session.conversationHistory.push({ role: 'user', content: message });
                session.conversationHistory.push({ role: 'assistant', content: confirmationResponse });
                
                await logConversationMessage(sessionId, 'user', message, {});
                await logConversationMessage(sessionId, 'assistant', confirmationResponse, { intent: 'escalation_sent' });
                
                return res.json({ response: confirmationResponse, sessionId });
            }
        }
        
        // Store previous context to detect changes
        const previousMaterial = session.context.material;
        const previousType = session.context.furnitureType;
        const previousSeats = session.context.seatCount;
        
        // ============================================
        // DETECT CHANGE REQUESTS - Clear whitelist if customer wants different products
        // ============================================
        const changeRequestPatterns = [
            'what about', 'how about', 'any other', 'anything else',
            'something else', 'different', 'alternative', 'other options',
            'instead', 'rather than', 'switch to', 'prefer',
            'cheaper', 'less expensive', 'more affordable', 'budget',
            'smaller', 'bigger', 'larger', 'more seats', 'fewer seats',
            'too expensive', 'too big', 'too small', 'too large',
            'show me more', 'show me different', 'show me other',
            'not these', "don't like these", 'dont like these'
        ];
        
        const isChangeRequest = changeRequestPatterns.some(pattern => msgLower.includes(pattern));
        if (isChangeRequest) {
            console.log(`ðŸ”„ Change request detected`);
        }
        
        // ============================================
        // MATERIAL EXTRACTION - All database values + synonyms
        // ============================================
        
        // Rattan (and synonyms)
        if (msgLower.includes('rattan') || msgLower.includes('wicker') || 
            msgLower.includes('poly rattan') || msgLower.includes('pe rattan') ||
            msgLower.includes('synthetic rattan')) {
            session.context.material = 'rattan';
            console.log(`ðŸ“ Context: material = rattan`);
        }
        
        // Teak
        if (msgLower.includes('teak')) {
            session.context.material = 'teak';
            console.log(`ðŸ“ Context: material = teak`);
        }
        
        // Wood (and synonyms) - check this AFTER teak so teak doesn't get overwritten
        if ((msgLower.includes('wood') || msgLower.includes('wooden') || 
             msgLower.includes('acacia') || msgLower.includes('hardwood')) &&
            !msgLower.includes('teak')) {
            session.context.material = 'wood';
            console.log(`ðŸ“ Context: material = wood`);
        }
        
        // Aluminium (and synonyms)
        if (msgLower.includes('aluminium') || msgLower.includes('aluminum') || 
            msgLower.includes('alloy')) {
            session.context.material = 'aluminium';
            console.log(`ðŸ“ Context: material = aluminium`);
        }
        
        // Metal (maps to aluminium for search, but also catches steel)
        if (msgLower.includes('metal') || msgLower.includes('steel')) {
            session.context.material = 'aluminium';
            console.log(`ðŸ“ Context: material = aluminium (from metal/steel)`);
        }
        
        // Woven
        if (msgLower.includes('woven') && !msgLower.includes('rattan')) {
            session.context.material = 'woven';
            console.log(`ðŸ“ Context: material = woven`);
        }
        
        // Clear whitelist if material changed
        if (previousMaterial && session.context.material && previousMaterial !== session.context.material) {
            console.log(`ðŸ”„ Material changed: ${previousMaterial} â†’ ${session.context.material} - clearing whitelist`);
            session.currentWhitelist = [];
        }
        
        // ============================================
        // FURNITURE TYPE EXTRACTION - All types + synonyms
        // ============================================
        
        // Dining
        if (msgLower.includes('dining') || msgLower.includes('dinner') || 
            msgLower.includes('eating') || msgLower.includes('table and chair')) {
            session.context.furnitureType = 'dining';
            console.log(`ðŸ“ Context: type = dining`);
        }
        
        // Lounge (and synonyms)
        if (msgLower.includes('lounge') || msgLower.includes('lounging') || 
            msgLower.includes('sofa') || msgLower.includes('couch') ||
            msgLower.includes('seating') || msgLower.includes('relax')) {
            session.context.furnitureType = 'lounge';
            console.log(`ðŸ“ Context: type = lounge`);
        }
        
        // Corner (and synonyms)
        if (msgLower.includes('corner') || msgLower.includes('l-shape') || 
            msgLower.includes('l shape') || msgLower.includes('l shaped')) {
            session.context.furnitureType = 'corner';
            console.log(`ðŸ“ Context: type = corner`);
        }
        
        // Sun lounger (and synonyms)
        if (msgLower.includes('sun lounger') || msgLower.includes('sunlounger') ||
            msgLower.includes('sunbed') || msgLower.includes('sun bed') ||
            msgLower.includes('daybed') || msgLower.includes('day bed') ||
            (msgLower.includes('lounger') && !msgLower.includes('lounge set'))) {
            session.context.furnitureType = 'lounger';
            console.log(`ðŸ“ Context: type = lounger`);
        }
        
        // Chaise
        if (msgLower.includes('chaise')) {
            session.context.furnitureType = 'lounge';
            session.context.subType = 'chaise';
            console.log(`ðŸ“ Context: type = lounge (chaise)`);
        }
        
        // Bistro (small sets)
        if (msgLower.includes('bistro') || msgLower.includes('cafe') ||
            msgLower.includes('balcony set') || msgLower.includes('2 person')) {
            session.context.furnitureType = 'dining';
            session.context.seatCount = 2;
            console.log(`ðŸ“ Context: type = dining (bistro), seats = 2`);
        }
        
        // Modular
        if (msgLower.includes('modular') || msgLower.includes('configurable')) {
            session.context.subType = 'modular';
            console.log(`ðŸ“ Context: subType = modular`);
        }
        
        // Accessories - v15.0: NEGATION AWARE
        const negationPrefixes = ['not the ', 'not a ', "don't want ", 'dont want ', 'no ', 'not '];
        const isNegatedCover = negationPrefixes.some(neg => msgLower.includes(neg + 'cover'));
        const isNegatedCushion = negationPrefixes.some(neg => msgLower.includes(neg + 'cushion'));
        const isNegatedAccessory = negationPrefixes.some(neg => msgLower.includes(neg + 'accessor'));
        
        if ((msgLower.includes('cover') && !isNegatedCover) || 
            (msgLower.includes('parasol') || msgLower.includes('umbrella')) || 
            (msgLower.includes('cushion') && !isNegatedCushion) ||
            msgLower.includes('storage') || 
            (msgLower.includes('accessory') && !isNegatedAccessory) ||
            (msgLower.includes('accessories') && !isNegatedAccessory)) {
            
            // Only set accessories type if family parser did NOT detect a furniture request
            if (!familyParse || !familyParse.family || familyParse.requestedType === 'cover' || familyParse.requestedType === 'cushion' || 
                familyParse.requestedType === 'cushion_box' || familyParse.requestedType === 'replacement_part') {
                session.context.furnitureType = 'accessories';
                console.log(`Context: type = accessories`);
                
                if (msgLower.includes('cover') && !isNegatedCover) session.context.subType = 'cover';
                if (msgLower.includes('parasol') || msgLower.includes('umbrella')) session.context.subType = 'parasol';
                if (msgLower.includes('cushion') && !isNegatedCushion) session.context.subType = 'cushion';
                if (msgLower.includes('storage')) session.context.subType = 'storage';
            } else {
                console.log(`Skipping accessories type - family parser detected furniture request`);
            }
        }
        
        // Clear whitelist if furniture type changed
        if (previousType && session.context.furnitureType && previousType !== session.context.furnitureType) {
            console.log(`ðŸ”„ Type changed: ${previousType} â†’ ${session.context.furnitureType} - clearing whitelist`);
            session.currentWhitelist = [];
        }
        
        // ============================================
        // SEAT COUNT EXTRACTION - Numbers + descriptive words
        // ============================================
        
        // Numeric patterns
        const seatMatch = msgLower.match(/(\d+)\s*(?:people|person|seat|seater|guests?)/);
        if (seatMatch) {
            session.context.seatCount = parseInt(seatMatch[1]);
            console.log(`ðŸ“ Context: seats = ${session.context.seatCount}`);
        }
        
        // Word-based numbers
        const wordToNumber = {
            'two': 2, 'couple': 2, 'pair': 2,
            'three': 3,
            'four': 4,
            'five': 5,
            'six': 6,
            'seven': 7,
            'eight': 8,
            'nine': 9,
            'ten': 10
        };
        
        for (const [word, num] of Object.entries(wordToNumber)) {
            if (msgLower.includes(word + ' people') || msgLower.includes(word + ' person') ||
                msgLower.includes(word + ' seat') || msgLower.includes(word + ' guest') ||
                msgLower.includes('for ' + word)) {
                session.context.seatCount = num;
                console.log(`ðŸ“ Context: seats = ${num} (from "${word}")`);
                break;
            }
        }
        
        // Size descriptors
        if (msgLower.includes('small') || msgLower.includes('compact') || 
            msgLower.includes('cosy') || msgLower.includes('cozy') ||
            msgLower.includes('tiny') || msgLower.includes('little')) {
            if (!session.context.seatCount) {
                session.context.sizePreference = 'small';
                console.log(`ðŸ“ Context: size preference = small`);
            }
            session.currentWhitelist = [];
        }
        
        if (msgLower.includes('large') || msgLower.includes('big') || 
            msgLower.includes('spacious') || msgLower.includes('family') ||
            msgLower.includes('entertaining') || msgLower.includes('party') ||
            msgLower.includes('guests')) {
            if (!session.context.seatCount) {
                session.context.sizePreference = 'large';
                console.log(`ðŸ“ Context: size preference = large`);
            }
            session.currentWhitelist = [];
        }
        
        // Relative size changes
        if (msgLower.includes('smaller') || msgLower.includes('fewer seat')) {
            console.log(`ðŸ“ Customer wants smaller - clearing whitelist`);
            session.context.sizePreference = 'smaller';
            session.currentWhitelist = [];
        }
        if (msgLower.includes('bigger') || msgLower.includes('larger') || msgLower.includes('more seat')) {
            console.log(`ðŸ“ Customer wants bigger - clearing whitelist`);
            session.context.sizePreference = 'larger';
            session.currentWhitelist = [];
        }
        
        // Clear whitelist if seat count changed
        if (previousSeats && session.context.seatCount && previousSeats !== session.context.seatCount) {
            console.log(`ðŸ”„ Seats changed: ${previousSeats} â†’ ${session.context.seatCount} - clearing whitelist`);
            session.currentWhitelist = [];
        }
        
        // ============================================
        // COLOUR EXTRACTION
        // ============================================
        if (msgLower.includes('grey') || msgLower.includes('gray')) {
            session.context.colour = 'grey';
            console.log(`ðŸ“ Context: colour = grey`);
        }
        if (msgLower.includes('black')) {
            session.context.colour = 'black';
            console.log(`ðŸ“ Context: colour = black`);
        }
        if (msgLower.includes('beige') || msgLower.includes('cream') || msgLower.includes('natural')) {
            session.context.colour = 'beige';
            console.log(`ðŸ“ Context: colour = beige`);
        }
        if (msgLower.includes('green')) {
            session.context.colour = 'green';
            console.log(`ðŸ“ Context: colour = green`);
        }
        if (msgLower.includes('taupe') || msgLower.includes('brown')) {
            session.context.colour = 'taupe';
            console.log(`ðŸ“ Context: colour = taupe`);
        }
        if (msgLower.includes('white')) {
            session.context.colour = 'white';
            console.log(`ðŸ“ Context: colour = white`);
        }
        
        // ============================================
        // PRICE SENSITIVITY EXTRACTION
        // ============================================
        const budgetWords = ['cheap', 'budget', 'affordable', 'inexpensive', 'low cost', 'bargain', 'value'];
        const premiumWords = ['premium', 'luxury', 'high-end', 'high end', 'top quality', 'best quality', 'expensive'];
        
        if (budgetWords.some(word => msgLower.includes(word))) {
            session.context.priceRange = 'budget';
            session.commercial.sentiment = 'price_concerned';
            console.log(`ðŸ“ Context: price range = budget`);
            session.currentWhitelist = [];
        }
        
        if (premiumWords.some(word => msgLower.includes(word))) {
            session.context.priceRange = 'premium';
            console.log(`ðŸ“ Context: price range = premium`);
        }
        
        // Price threshold detection
        const priceMatch = msgLower.match(/(?:under|below|less than|up to|max|maximum)\s*Â£?\s*(\d+)/);
        if (priceMatch) {
            session.context.maxPrice = parseInt(priceMatch[1]);
            console.log(`ðŸ“ Context: max price = Â£${session.context.maxPrice}`);
            session.currentWhitelist = [];
        }
        
        const minPriceMatch = msgLower.match(/(?:over|above|more than|at least|minimum)\s*Â£?\s*(\d+)/);
        if (minPriceMatch) {
            session.context.minPrice = parseInt(minPriceMatch[1]);
            console.log(`ðŸ“ Context: min price = Â£${session.context.minPrice}`);
        }
        
        // "too expensive" detection
        if (msgLower.includes('too expensive') || msgLower.includes('too much') || 
            msgLower.includes('too pricey') || msgLower.includes('can\'t afford')) {
            session.commercial.sentiment = 'price_concerned';
            console.log(`ðŸ’° Price concern detected - clearing whitelist`);
            session.currentWhitelist = [];
        }

        // ============================================
        // DIMENSION QUERY DETECTION
        // ============================================
        const dimensionPatterns = [
            'how big', 'what size', 'dimensions', 'measurements', 'measure',
            'will it fit', 'does it fit', 'fit in my', 'fit my',
            'how wide', 'how deep', 'how tall', 'how long', 'how small',
            'footprint', 'floor space', 'how much room', 'space required',
            'square metre', 'sq m', 'sqm'
        ];
        
        const isDimensionQuery = dimensionPatterns.some(p => msgLower.includes(p));
        
        if (isDimensionQuery) {
            session.context.queryType = 'dimensions';
            console.log(`ðŸ“ Dimension query detected`);
        }
        
        // Detect space size from customer (e.g., "my space is 200cm x 300cm")
        const spaceMatch = msgLower.match(/(\d+)\s*(?:cm|m)?\s*(?:x|by)\s*(\d+)\s*(?:cm|m)?/);
        if (spaceMatch) {
            let dim1 = parseInt(spaceMatch[1]);
            let dim2 = parseInt(spaceMatch[2]);
            
            // If numbers seem like metres, convert to cm
            if (dim1 < 10) dim1 = dim1 * 100;
            if (dim2 < 10) dim2 = dim2 * 100;
            
            session.context.customerSpace = {
                width: Math.min(dim1, dim2),
                length: Math.max(dim1, dim2)
            };
            console.log(`ðŸ“ Customer space detected: ${session.context.customerSpace.width}cm Ã— ${session.context.customerSpace.length}cm`);
        }
        
        // Detect box/delivery dimension queries
        const boxDimensionPatterns = [
            'box size', 'box dimension', 'delivery box', 'fit through',
            'fit in my car', 'fit in car', 'door', 'entrance', 'how does it arrive',
            'packaging', 'how many boxes'
        ];
        
        const isBoxQuery = boxDimensionPatterns.some(p => msgLower.includes(p));
        
        if (isBoxQuery) {
            session.context.queryType = 'box_dimensions';
            console.log(`ðŸ“¦ Box dimension query detected`);
        }
        
        // ============================================
        // GENERIC CHANGE REQUEST - Clear whitelist
        // ============================================
        if (isChangeRequest && session.currentWhitelist.length > 0) {
            console.log(`ðŸ”„ Change request with existing whitelist - clearing for fresh search`);
            session.currentWhitelist = [];
        }
    
        // ============================================
        // DETECT CUSTOMER SENTIMENT AND PURCHASE INTENT
        // ============================================
        const sentiment = detectCustomerSentiment(message);
        
        // Store latest sentiment for closing copy decisions
        session.commercial.latestSentiment = sentiment;
        
        if (sentiment.priceConcerned) {
            session.commercial.sentiment = 'price_concerned';
            console.log(`ðŸ’° Sentiment: Price concerned`);
        } else if (sentiment.positive) {
            session.commercial.sentiment = 'positive';
            session.commercial.positiveSignalReceived = true;
            console.log(`ðŸ˜Š Sentiment: Positive signal received`);
        }
        
        if (sentiment.strongPositive) {
            session.commercial.strongPositiveReceived = true;
            console.log(`ðŸŽ¯ Sentiment: Strong positive - customer has chosen!`);
        }
        
        if (sentiment.bundleInterest) {
            session.commercial.bundleInterestShown = true;
            console.log(`ðŸŽ Bundle interest detected`);
        }
        
        // ============================================
        // DETECT CUSTOMER FRUSTRATION / LEAVING
        // ============================================
        const leavingPatterns = [
            'buy elsewhere', 'buying elsewhere', 'go elsewhere', 'going elsewhere',
            'try somewhere else', 'look elsewhere', 'shop elsewhere',
            'forget it', 'never mind', 'nevermind', 'give up',
            'waste of time', 'useless', 'hopeless', 'frustrated',
            'going to competitor', 'amazon', 'wayfair', 'john lewis',
            'this is ridiculous', 'terrible', 'awful experience'
        ];
        
        const isLeaving = leavingPatterns.some(p => msgLower.includes(p));
        
        if (isLeaving) {
            console.log(`ðŸš¨ LOST_SALE: Customer leaving - "${message.substring(0, 80)}..."`);
            session.commercial.sentiment = 'leaving';
            session.commercial.lostSaleReason = message;
            session.commercial.lostSaleTimestamp = new Date().toISOString();
        }
        
        if (sentiment.decline) {
            if (session.commercial.lastOfferType === 'bundle') {
                session.commercial.bundleDeclined = true;
                console.log(`=ÂÅ’ Bundle offer declined`);
            } else if (session.commercial.lastOfferType === 'upsell') {
                session.commercial.upsellDeclined = true;
                console.log(`=ÂÅ’ Upsell declined`);
            }
        }
        
        // ============================================
        // PURCHASE INTENT HANDLING - TRIGGER CLOSING FLOW
        // ============================================
        if (sentiment.readyToBuy && session.commercial.productsShown.length > 0) {
            console.log(`ðŸ›’ PURCHASE INTENT DETECTED - Triggering closing flow`);
            
            // Build closing response directly - don't let AI show more products
            const closingResponse = buildClosingResponse(session, sentiment);
            
            // Add to conversation history
            session.conversationHistory.push({
                role: 'user',
                content: message,
                timestamp: new Date().toISOString()
            });
            session.conversationHistory.push({
                role: 'assistant',
                content: closingResponse.text,
                metadata: {
                    intent: 'checkout_flow',
                    timestamp: new Date().toISOString()
                }
            });
            
            console.log(`ðŸ“¤ Closing flow response sent`);
            
            // Log both messages to database
            await logConversationMessage(sessionId, 'customer', message, {
                sentiment: session.commercial.sentiment
            });
            await logConversationMessage(sessionId, 'gwen', closingResponse.text, {
                intent: 'checkout_flow',
                productsShown: session.commercial.productsShown.slice(-3),
                sentiment: session.commercial.sentiment
            });
            
            return res.json({
                response: closingResponse.text,
                sessionId: sessionId
            });
        }
        
        // Build session state for AI
        const sessionState = {
            messageCount: session.messageCount,
            established: session.context,
            commercial: session.commercial,
            availableSkus: session.currentWhitelist
        };
        
        const systemPrompt = buildSystemPrompt(sessionState);
        
        // CRITICAL: Include conversation history so AI has context
        let messages = [
            { role: "system", content: systemPrompt }
        ];
        
        // Add conversation history (previous exchanges)
        for (const msg of session.conversationHistory) {
            messages.push(msg);
        }
        
        // Add current user message
        messages.push({ role: "user", content: message });
        
        console.log(`ðŸ’¬ Sending ${messages.length} messages to AI (${session.conversationHistory.length} history)`);
        console.log(`ðŸ“‹ Context: ${JSON.stringify(session.context)}`);
        
        // Call AI
        let response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: messages,
            tools: aiTools,
            tool_choice: "auto",
            temperature: 0.4
        });
        
        let aiMessage = response.choices[0].message;
        
        // Handle tool calls
        if (aiMessage.tool_calls) {
            const toolResults = [];
            
            for (const toolCall of aiMessage.tool_calls) {
                const args = JSON.parse(toolCall.function.arguments);
                
                if (toolCall.function.name === "search_products") {
                    console.log(`Search:`, args);
                    
                    if (args.furnitureType) session.context.furnitureType = args.furnitureType;
                    if (args.seatCount) session.context.seatCount = args.seatCount;
                    if (args.material) session.context.material = args.material;
                    
                    // v15.0: Detect if customer is asking for furniture (not accessories)
                    const wantsFurniture = msgLower.includes('set') || msgLower.includes('sofa') || 
                                          msgLower.includes('dining') || msgLower.includes('lounge') ||
                                          msgLower.includes('corner') || msgLower.includes('seater') ||
                                          msgLower.includes('furniture');
                    
                    // v15.0: Resolve family from AI arg or session
                    let searchFamily = null;
                    let searchFamilyType = null;
                    if (args.productFamily) {
                        searchFamily = resolveFamily(args.productFamily);
                        searchFamilyType = session.context.requestedFamilyType || (wantsFurniture ? 'furniture' : 'furniture_priority');
                    } else if (session.context.requestedFamily) {
                        searchFamily = session.context.requestedFamily;
                        searchFamilyType = session.context.requestedFamilyType || 'furniture_priority';
                    }
                    
                    // v15.0: Check if customer wants different products
                    const isShowDifferent = msgLower.includes('different') || msgLower.includes('other') || 
                                           msgLower.includes('alternative') || msgLower.includes('show me more') ||
                                           msgLower.includes('something else');
                    
                    // v15.0: Enhanced search criteria with exclusions + family
                    const searchCriteria = {
                        ...args,
                        excludedCategories: session.excludedCategories || [],
                        excludedProductTypes: session.excludedProductTypes || [],
                        prioritizeFurniture: wantsFurniture || (searchFamilyType === 'furniture') || (searchFamilyType === 'furniture_priority'),
                        requestedFamily: searchFamily,
                        requestedFamilyType: searchFamilyType,
                        productsAlreadyShown: isShowDifferent ? (session.commercial.productsShown || []) : [],
                        includePreOrder: true
                    };
                    
                    const products = searchProducts(searchCriteria);
                    
                    session.currentWhitelist = products.map(p => p.sku);
                    console.log(`ðŸ›¡ï¸ Whitelist: [${session.currentWhitelist.join(', ')}]`);
                    
                    // Check if products actually meet the seat requirement
                    let seatWarning = null;
                    if (args.seatCount && products.length > 0) {
                        const requestedSeats = parseInt(args.seatCount);
                        const maxSeatsFound = Math.max(...products.map(p => parseInt(p.seats) || 0));
                        if (maxSeatsFound < requestedSeats) {
                            seatWarning = `Customer requested ${requestedSeats}+ seats but largest available is ${maxSeatsFound} seats. Be honest about this limitation.`;
                        }
                    }
                    
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({
                            success: products.length > 0,
                            available_skus: session.currentWhitelist,
                            count: products.length,
                            products: products,
                            searched_for: args,
                            warning: seatWarning,
                            note: products.length > 0 
                                ? "Use ONLY these SKUs. Server renders details. " + (seatWarning || "")
                                : "No in-stock products found matching criteria. Suggest alternatives or ask about different requirements."
                        })
                    });
                }
                
                if (toolCall.function.name === "get_material_info") {
                    const info = materialInfo[args.material] || {
                        warranty: "Please contact us for details",
                        maintenance: "Varies by product"
                    };
                    
                    toolResults.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify(info)
                    });
                }
                
                         if (toolCall.function.name === "request_human_handoff") {
                    console.log(`ðŸ“§ ESCALATION REQUESTED:`, args);
                    
                    // Validate email if provided
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    
                    if (!args.customerEmail || !emailRegex.test(args.customerEmail)) {
                        // No email - ask for it first
                        console.log(`âš ï¸ Escalation requested but no valid email provided`);
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: false,
                                needsEmail: true,
                                message: "Before I connect you with our support team, I'll need your email address so they can get back to you. What's the best email to reach you on?"
                            })
                        });
                    } else {
                        // Have email - send escalation
                        session.customerEmail = args.customerEmail;
                        session.escalationReason = args.reason;
                        
                        // Send the actual escalation email
                        const emailResult = await sendEscalationEmail(
                            args.customerEmail,
                            args.customerName || 'Not provided',
                            args.reason,
                            session.conversationHistory || [],
                            session.commercial.productsShown || []
                        );
                        
                        console.log(`ðŸ“§ ESCALATION sent for: ${args.customerEmail}`);
                        console.log(`ðŸ“§ Reason: ${args.reason}`);
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: true,
                                emailSent: emailResult.success,
                                customerEmail: args.customerEmail,
                                message: `Escalation sent to our support team. Tell the customer: "I've passed your details to our customer service team. They will email you at ${args.customerEmail} within a few hours (or first thing tomorrow if outside business hours). Is there anything else I can help with in the meantime?"`
                            })
                        });
                    }
                }
                
                if (toolCall.function.name === "capture_email_for_quote") {
                    console.log(`ðŸ“§ Email capture:`, args);
                    
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(args.email)) {
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: false,
                                message: "That doesn't look like a valid email. Please ask for a valid email address."
                            })
                        });
                    } else {
                        session.customerEmail = args.email;
                        const productsForQuote = args.productSkus || session.commercial.productsShown.slice(-3);
                        
                        console.log(`ðŸ“§ Quote requested for: ${args.email}`);
                        console.log(`ðŸ“§ Products: ${productsForQuote.join(', ')}`);
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: true,
                                email: args.email,
                                products: productsForQuote,
                                message: `Email captured successfully. Confirm to customer that quote will be sent to ${args.email} within a few minutes, with their discount locked in for 48 hours. Also mention they can reply to the email if they have questions.`
                            })
                        });
                    }
                }
                
               if (toolCall.function.name === "initiate_checkout") {
                    console.log(`ðŸ›’ Checkout initiated:`, args);
                    
                    // Try to find product by SKU first, then by name
                    let product = productIndex.bySku[args.productSku];
                    let actualSku = args.productSku;
                    
                    // If not found by SKU, try finding by name
                    if (!product && args.productSku) {
                        console.log(`ðŸ” Product not found by SKU, trying name lookup: "${args.productSku}"`);
                        const productResult = findProductByName(args.productSku, session.commercial.productsShown);
                        if (productResult) {
                            product = productResult.product;
                            actualSku = productResult.sku;
                            console.log(`âœ… Found product by name: ${actualSku}`);
                        }
                    }
                    
                    if (!product) {
                        // Log what we tried to find for debugging
                       console.log(`âŒ LOST_SALE: Could not find product: "${args.productSku}"`);
                        console.log(`   Products shown this session: [${session.commercial.productsShown.join(', ')}]`);
                        
                        // If we have products shown this session, suggest those
                        let helpfulMessage = "I couldn't find that specific product.";
                        
                        if (session.commercial.productsShown.length > 0) {
                            const lastProduct = session.commercial.productsShown[session.commercial.productsShown.length - 1];
                            const lastProductData = productIndex.bySku[lastProduct];
                            if (lastProductData) {
                                helpfulMessage = `I want to make sure I help you order the right product. Were you interested in the ${lastProductData.product_identity?.product_name}? Just confirm and I'll show you how to complete your purchase.`;
                            }
                        } else {
                            helpfulMessage = "I'd love to help you complete your purchase! Could you tell me which product you'd like to order, and I'll show you the checkout options.";
                        }
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: false,
                                message: helpfulMessage,
                                productsShown: session.commercial.productsShown,
                                note: "DO NOT generate a URL. Ask the customer to confirm which product they want, then call initiate_checkout again with the correct SKU."
                            })
                        });
                    } else {
                        const productUrl = `https://www.mint-outdoor.com/products/${actualSku.toLowerCase().replace(/\s+/g, '-')}`;
                        const price = parseFloat(product.product_identity?.price_gbp) || 0;
                        
                        let checkoutInfo = {
                            success: true,
                            productName: product.product_identity?.product_name,
                            productUrl: productUrl,
                            price: price,
                            message: `Direct the customer to click the ORDER NOW button or visit: ${productUrl}`
                        };
                        
                        if (args.includeBundle) {
                            const bundles = getBundleForProduct(args.productSku);
                            if (bundles.length > 0) {
                                const bundle = bundles[0];
                                let bundleTotal = 0;
                                for (const item of bundle.products) {
                                    const prod = productIndex.bySku[item.product_sku];
                                    if (prod) {
                                        bundleTotal += (parseFloat(prod.product_identity?.price_gbp) || 0) * item.product_qty;
                                    }
                                }
                                const discount = bundleTotal * 0.20;
                                checkoutInfo.bundlePrice = bundleTotal - discount;
                                checkoutInfo.bundleSavings = discount;
                                checkoutInfo.message += ` Bundle discount of 20% (saving Â£${discount.toFixed(2)}) applies at checkout when they add the matching cover.`;
                            }
                        }
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify(checkoutInfo)
                        });
                    }
                }
if (toolCall.function.name === "get_product_dimensions") {
                    console.log(`ðŸ“ Dimension query:`, args);
                    
                    // Find the product
                    let productResult = null;
                    
                    if (args.productSku) {
                        const product = productIndex.bySku[args.productSku];
                        if (product) {
                            productResult = { sku: args.productSku, product, source: 'sku' };
                        }
                    }
                    
                    if (!productResult && args.productName) {
                        productResult = findProductByName(args.productName, session.commercial.productsShown);
                    }
                    
                    if (!productResult) {
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: false,
                                message: `I couldn't find a product matching "${args.productName || args.productSku}". Please ask the customer to clarify which product they're asking about.`
                            })
                        });
                    } else {
                        const dimensionResult = await renderDimensionCard(productResult.sku, {
                            showBoxDimensions: args.includeBoxDimensions || false
                        });
                        
                        if (dimensionResult.type === 'dimension_missing') {
                            toolResults.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify({
                                    success: true,
                                    hasDimensions: false,
                                    productName: dimensionResult.productName,
                                    productSku: dimensionResult.sku,
                                    productUrl: dimensionResult.productUrl,
                                    message: dimensionResult.fallbackMessage,
                                    note: "Dimensions not available. Show the fallback message to the customer. They can check the product page or provide email for follow-up."
                                })
                            });
                        } else {
                            toolResults.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify({
                                    success: true,
                                    hasDimensions: true,
                                    productName: dimensionResult.productName,
                                    productSku: dimensionResult.sku,
                                    productUrl: dimensionResult.productUrl,
                                    dimensions: dimensionResult.dimensions,
                                    dimensionCard: dimensionResult.card,
                                    note: "Dimension card ready. Output intent: dimension_query with product_sku set. The server will render the dimension card."
                                })
                            });
                        }
                    }
                }

                // ============================================
                // FIND ACCESSORIES TOOL HANDLER
                // ============================================
                if (toolCall.function.name === "find_accessories") {
                    console.log(`ðŸŽ Accessory search:`, args);
                    
                    let mainProduct = null;
                    let mainSku = null;
                    
                    // Try to find by SKU first
                    if (args.productSku) {
                        mainProduct = productIndex.bySku[args.productSku];
                        mainSku = args.productSku;
                    }
                    
                    // If not found by SKU, try finding by name
                    if (!mainProduct && args.productName) {
                        const result = findProductByName(args.productName, session.commercial.productsShown);
                        if (result) {
                            mainProduct = result.product;
                            mainSku = result.sku;
                            console.log(`âœ… Found main product by name: ${mainSku}`);
                        }
                    }
                    
                    if (!mainProduct) {
                        console.log(`âŒ Could not find main product for accessories`);
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: false,
                                message: `I couldn't find the product "${args.productName || args.productSku}". Could you confirm which product you'd like accessories for?`
                            })
                        });
                    } else {
                        const accessoryType = args.accessoryType === 'any' ? null : args.accessoryType;
                        const accessories = findRelatedAccessories(mainSku, accessoryType);
                        
                        console.log(`ðŸŽ Found ${accessories.length} accessories for ${mainSku}`);
                        
                        // Add main product and accessories to whitelist
                        session.currentWhitelist = [mainSku, ...accessories.map(a => a.sku)];
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: true,
                                mainProduct: {
                                    sku: mainSku,
                                    name: mainProduct.product_identity?.product_name,
                                    price: mainProduct.product_identity?.price_gbp
                                },
                                accessories: accessories,
                                accessoryCount: accessories.length,
                                available_skus: session.currentWhitelist,
                                note: accessories.length > 0 
                                    ? `Found ${accessories.length} accessories. Show the main product AND accessories using product_recommendation intent with these SKUs: ${session.currentWhitelist.join(', ')}`
                                    : `No matching accessories found for this product. Let the customer know and offer to check other options or contact our team.`
                            })
                        });
                    }
                }

            }
            
            messages.push(aiMessage);
            
            for (const result of toolResults) {
                messages.push({
                    role: "tool",
                    content: result.output,
                    tool_call_id: result.tool_call_id
                });
            }
            
            sessionState.availableSkus = session.currentWhitelist;
            messages[0].content = buildSystemPrompt(sessionState);
            
            response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: messages,
                response_format: { type: "json_object" },
                temperature: 0.4
            });
            
            aiMessage = response.choices[0].message;
        }
        
// ============================================
        // ROBUST JSON PARSING WITH CONTEXT PRESERVATION
        // ============================================
        
        let aiOutput;
        
        // LAYER 1: Try direct JSON parse
        try {
            aiOutput = JSON.parse(aiMessage.content);
            console.log(`âœ… AI intent: ${aiOutput.intent}`);
        } catch (parseError) {
            console.log(`âš Ã¯Â¸Â JSON parse failed, trying extraction...`);
            
            // LAYER 2: Try to extract JSON from markdown code blocks
            const jsonMatch = aiMessage.content?.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                try {
                    aiOutput = JSON.parse(jsonMatch[1].trim());
                    console.log(`âœ… Extracted JSON from code block`);
                } catch (e2) {
                    console.log(`âš Ã¯Â¸Â Code block extraction failed`);
                }
            }
            
            // LAYER 3: Try to find JSON object in response
            if (!aiOutput) {
                const objectMatch = aiMessage.content?.match(/\{[\s\S]*\}/);
                if (objectMatch) {
                    try {
                        aiOutput = JSON.parse(objectMatch[0]);
                        console.log(`âœ… Extracted JSON object from response`);
                    } catch (e3) {
                        console.log(`âš Ã¯Â¸Â Object extraction failed`);
                    }
                }
            }
            
            // ============================================
            // LAYER 4: CONTEXT-AWARE INTELLIGENT FALLBACK
            // ============================================
            if (!aiOutput) {
                console.log(`ðŸ”„ Using context-aware fallback`);
                const ctx = session.context;
                const hasWhitelist = session.currentWhitelist && session.currentWhitelist.length > 0;
                const hasContext = ctx.material || ctx.furnitureType || ctx.seatCount;
                
                // ============================================
                // PRIORITY 0: ESCALATION/SUPPORT REQUEST DETECTION
                // ============================================
                const escalationPatterns = [
                    'contact support', 'contact team', 'contact you', 'contact someone',
                    'speak to someone', 'speak to a person', 'speak to a human', 'speak to agent',
                    'talk to someone', 'talk to a person', 'talk to a human', 'talk to agent',
                    'customer service', 'customer support', 'support team', 'help desk',
                    'real person', 'real human', 'human agent', 'live agent', 'live chat',
                    'phone number', 'call you', 'email you', 'email address', 'email me',
                    'get in touch', 'how do i contact', 'how can i contact', 'how to contact',
                    'need help', 'need assistance', 'this is useless', 'you\'re useless',
                    'not helpful', 'can\'t help', 'cannot help'
                ];
                
                const wantsEscalation = escalationPatterns.some(p => msgLower.includes(p));
                
                if (wantsEscalation) {
                    console.log(`ðŸš¨ ESCALATION REQUEST DETECTED in fallback`);
                    
                    // Check if we already have their email
                    if (session.customerEmail) {
                        // We have email - send escalation directly
                        const emailResult = await sendEscalationEmail(
                            session.customerEmail,
                            session.customerName || 'Not provided',
                            `Customer requested human support. Last message: "${message}"`,
                            session.conversationHistory || [],
                            session.commercial.productsShown || []
                        );
                        
                        aiOutput = {
                            intent: 'escalation_sent',
                            response_text: `I've passed your request to our customer service team. They will email you at ${session.customerEmail} within a few hours (or first thing tomorrow if outside business hours). Is there anything else I can help with in the meantime?`
                        };
                    } else {
                        // Need to capture email first
                        session.pendingEscalation = true;
                        session.escalationReason = message;
                        
                        aiOutput = {
                            intent: 'email_capture_for_escalation',
                            response_text: `I'd be happy to connect you with our customer service team who can help with this. They typically respond within a few hours.\n\nTo make sure they can get back to you quickly, could you please share your email address? I'll pass on our conversation so they have all the context.`
                        };
                    }
                }
                
                // PRIORITY 0.5: Check if customer just provided email after escalation request
                if (!aiOutput && session.pendingEscalation) {
                    const emailMatch = message.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
                    if (emailMatch) {
                        session.customerEmail = emailMatch[0];
                        session.pendingEscalation = false;
                        
                        // Send escalation email
                        const emailResult = await sendEscalationEmail(
                            session.customerEmail,
                            session.customerName || 'Not provided',
                            session.escalationReason || 'Customer requested human support',
                            session.conversationHistory || [],
                            session.commercial.productsShown || []
                        );
                        
                        console.log(`ðŸ“§ ESCALATION EMAIL SENT after email capture: ${session.customerEmail}`);
                        
                        aiOutput = {
                            intent: 'escalation_sent',
                            response_text: `Perfect, thank you! I've sent your details and our conversation to our customer service team. They will email you at ${session.customerEmail} within a few hours (or first thing tomorrow if outside business hours).\n\nIs there anything else I can help with in the meantime?`
                        };
                    }
                }
                
                // PRIORITY 1: Check if customer mentioned a SPECIFIC PRODUCT BY NAME
                const productNamePatterns = [
                    'stockholm', 'faro', 'malaga', 'palma', 'santorini', 'barcelona',
                    'sorrento', 'valencia', 'milano', 'como', 'kiki', 'chesterton',
                    'chaise', 'lounger', 'daybed', 'bistro'
                ];
                
                const mentionedProduct = productNamePatterns.find(name => 
                    msgLower.includes(name.toLowerCase())
                );
                
                if (mentionedProduct) {
                    console.log(`Â Fallback: Customer mentioned "${mentionedProduct}" - searching`);
                    
                    const productSearch = searchProducts({ 
                        productName: mentionedProduct,
                        maxResults: 3
                    });
                    
                    if (productSearch.length > 0) {
                        session.currentWhitelist = productSearch.map(p => p.sku);
                        aiOutput = {
                            intent: 'product_recommendation',
                            intro_copy: `Here's what I found for "${mentionedProduct}":`,
                            selected_skus: session.currentWhitelist.slice(0, 2),
                            personalisation: '',
                            closing_copy: "Would you like more details?"
                        };
                        console.log(`âœ… Fallback: Found ${productSearch.length} products`);
                    } else {
                        aiOutput = {
                            intent: 'question_answer',
                            response_text: `I couldn't find "${mentionedProduct}" in stock. Would you like me to show similar alternatives?`
                        };
                    }
                }
                
                // PRIORITY 2: Check if customer is asking a QUESTION
                if (!aiOutput) {
                    const questionPatterns = [
                        'what happens', 'what if', 'what about', 'how do', 'how long',
                        'can i', 'can you', 'do you', 'does it', 'will it', 'is it',
                        'warranty', 'guarantee', 'return', 'refund', 'delivery', 'shipping',
                        'wear', 'tear', 'break', 'damage', 'repair', 'maintenance', 'care',
                        'clean', 'weather', 'rain', 'winter', 'made of', 'made from'
                    ];
                    
                    const isAskingQuestion = questionPatterns.some(p => msgLower.includes(p)) || msgLower.includes('?');
                    
                    if (isAskingQuestion) {
                        console.log(`â“ Fallback: Detected question`);
                        
                        let helpfulResponse = "";
                        
                        // ============================================
                        // EN-581 QUALITY & TESTING QUESTIONS
                        // ============================================
                        
                        // Weight limit questions - specific handling
                        const weightPatterns = ['weight limit', 'how much weight', 'how heavy', 'weight capacity', 
                                               'can it hold', 'maximum weight', 'stone', 'kg limit', 'heavy person',
                                               'big person', 'large person', 'overweight', 'bariatric'];
                        const isWeightQuestion = weightPatterns.some(p => msgLower.includes(p));
                        
                        // Quality/testing questions
                        const qualityPatterns = ['quality', 'tested', 'testing', 'how strong', 'is it strong', 
                                                'will it break', 'will it last', 'durable', 'durability',
                                                'sturdy', 'robust', 'solid', 'reliable', 'safe', 'safety',
                                                'certified', 'certification', 'standard', 'en-581', 'en581',
                                                'bs en', 'european standard', 'british standard'];
                        const isQualityQuestion = qualityPatterns.some(p => msgLower.includes(p));
                        
                        // Stability questions
                        const stabilityPatterns = ['tip over', 'tipping', 'wobble', 'wobbly', 'stable', 'stability',
                                                   'fall over', 'topple', 'uneven', 'rock', 'rocking'];
                        const isStabilityQuestion = stabilityPatterns.some(p => msgLower.includes(p));
                        
                        if (isWeightQuestion) {
                            console.log(`âš–ï¸ Fallback: Weight limit question detected`);
                            helpfulResponse = en581Info.weightLimit.response;
                            
                            // Check if they might need higher capacity
                            if (msgLower.includes('more than') || msgLower.includes('over') || 
                                msgLower.includes('higher') || msgLower.includes('bariatric')) {
                                session.escalationOffered = true;
                                session.escalationReason = 'Customer enquiring about higher weight capacity furniture';
                            }
                        } else if (isStabilityQuestion) {
                            console.log(`ðŸª‘ Fallback: Stability question detected`);
                            helpfulResponse = en581Info.customerQuestions.stability;
                        } else if (isQualityQuestion) {
                            console.log(`âœ… Fallback: Quality/testing question detected`);
                            
                            // Give more specific answer based on what they asked
                            if (msgLower.includes('strong') || msgLower.includes('break')) {
                                helpfulResponse = en581Info.customerQuestions.strength;
                            } else if (msgLower.includes('last') || msgLower.includes('durable') || msgLower.includes('durability')) {
                                helpfulResponse = en581Info.customerQuestions.durability;
                            } else if (msgLower.includes('safe') || msgLower.includes('safety')) {
                                helpfulResponse = en581Info.customerQuestions.safetyFeatures;
                            } else {
                                helpfulResponse = en581Info.customerQuestions.quality;
                            }
                        } else if (msgLower.includes('wear') || msgLower.includes('tear') || msgLower.includes('break') || msgLower.includes('damage')) {
                            helpfulResponse = "Great question! Our furniture is built to last:\n\n**Within warranty (2 years for rattan):** We repair or replace manufacturing defects free of charge.\n\n**After warranty:** Minor damage can often be repaired. We stock spare parts and replacement cushion covers.\n\n**Maximise lifespan:** Use a protective cover - extends life by 3-5 years!\n\nWould you like details on protective covers?";
                        } else if (msgLower.includes('warranty') || msgLower.includes('guarantee')) {
                            helpfulResponse = "Our warranty coverage:\n\n= **Rattan:** 2 years structural + colour\n= **Aluminium:** 10 years corrosion\n= **Teak:** 5 years structural\n= **Cushions:** 1 year\n\nAnything specific you'd like to know?";
                        } else if (msgLower.includes('delivery') || msgLower.includes('shipping')) {
                            helpfulResponse = "We offer fast UK delivery:\n\n= 3-5 working days\n= Free on orders over Â£500\n= Tracking sent when shipped\n\nAnything else I can help with?";
                        } else if (msgLower.includes('clean') || msgLower.includes('maintenance') || msgLower.includes('care')) {
                            helpfulResponse = "Care is easy:\n\n= **Rattan:** Wipe with damp cloth. Cover in harsh winters.\n= **Aluminium:** Just soapy water occasionally.\n= **Teak:** Oil annually or let weather to silver-grey.\n\nWould you like more tips?";
                        } else if (msgLower.includes('weather') || msgLower.includes('rain') || msgLower.includes('winter')) {
                            helpfulResponse = en581Info.customerQuestions.weatherResistance;
                        } else {
                            helpfulResponse = "I'd be happy to help! I can assist with:\n\n= Warranty info\n= Delivery details\n= Care and maintenance\n= Product specifications\n\nWhat would you like to know?";
                        }
                        
                        aiOutput = {
                            intent: 'question_answer',
                            response_text: helpfulResponse
                        };
                    }
                }

// PRIORITY 2: Check for DIMENSION queries
                if (!aiOutput) {
                    const dimensionPatterns = [
                        'how big', 'what size', 'dimensions', 'measurements',
                        'will it fit', 'does it fit', 'fit in my', 'how wide',
                        'how deep', 'how tall', 'how long', 'how small',
                        'footprint', 'floor space', 'space required'
                    ];
                    
                    const isDimensionQuery = dimensionPatterns.some(p => msgLower.includes(p));
                    
                    if (isDimensionQuery) {
                        console.log(`ðŸ“ Fallback: Detected dimension query`);
                        
                        // Try to identify which product they're asking about
                        const productsShown = session.commercial.productsShown || [];
                        let productFound = null;
                        
                        // Check for product names in the message
                        const productFamilies = ['marbella', 'stockholm', 'palma', 'faro', 'lima', 'harbour', 
                                                  'santorini', 'cora', 'bayswater', 'cove', 'oxford', 'chesterton',
                                                  'kiki', 'linden', 'malaga', 'alanne', 'lark', 'havana', 'sloane'];
                        
                        for (const family of productFamilies) {
                            if (msgLower.includes(family)) {
                                productFound = findProductByName(family, productsShown);
                                break;
                            }
                        }
                        
                        // If no specific product mentioned, try the most recently shown
                        if (!productFound && productsShown.length > 0) {
                            const lastShown = productsShown[productsShown.length - 1];
                            productFound = { sku: lastShown, product: productIndex.bySku[lastShown], source: 'last_shown' };
                            console.log(`ðŸ“ Using last shown product: ${lastShown}`);
                        }
                        
                        if (productFound) {
                            const includeBoxDimensions = session.context.queryType === 'box_dimensions';
                            
                            aiOutput = {
                                intent: 'dimension_query',
                                product_sku: productFound.sku,
                                include_box_dimensions: includeBoxDimensions,
                                response_text: ''
                            };
                            console.log(`âœ… Fallback: Dimension query for ${productFound.sku}`);
                        } else {
                            aiOutput = {
                                intent: 'clarification',
                                response_text: "I'd be happy to help with dimensions! Which product would you like to know the size of?"
                            };
                            console.log(`=Ââ€œ Fallback: Asking which product for dimensions`);
                        }
                    }
                }

                  // PRIORITY 3: Check if customer is asking a general QUESTION
                if (!aiOutput) {
                    const questionPatterns = [
                        'what happens', 'what if', 'what about', 'how do', 'how long',
                        'can i', 'can you', 'do you', 'does it', 'will it', 'is it',
                        'warranty', 'guarantee', 'return', 'refund', 'delivery', 'shipping',
                        'wear', 'tear', 'break', 'damage', 'repair', 'maintenance', 'care',
                        'clean', 'weather', 'rain', 'winter', 'made of', 'made from'
                    ];
                    
                    const isAskingQuestion = questionPatterns.some(p => msgLower.includes(p)) || msgLower.includes('?');
                    
                    if (isAskingQuestion) {
                        console.log(`=Ââ€œ Fallback: Detected question`);
                        
                        let helpfulResponse = "";
                        
                        if (msgLower.includes('wear') || msgLower.includes('tear') || msgLower.includes('break') || msgLower.includes('damage')) {
                            helpfulResponse = "Great question! Our furniture is built to last:\n\n**Within warranty (2 years for rattan):** We repair or replace manufacturing defects free of charge.\n\n**After warranty:** Minor damage can often be repaired. We stock spare parts and replacement cushion covers.\n\n**Maximise lifespan:** Use a protective cover - extends life by 3-5 years!\n\nWould you like details on protective covers?";
                        } else if (msgLower.includes('warranty') || msgLower.includes('guarantee')) {
                            helpfulResponse = "Our warranty coverage:\n\n= **Rattan:** 2 years structural + colour\n= **Aluminium:** 10 years corrosion\n= **Teak:** 5 years structural\n= **Cushions:** 1 year\n\nAnything specific you'd like to know?";
                        } else if (msgLower.includes('delivery') || msgLower.includes('shipping')) {
                            helpfulResponse = "We offer fast UK delivery:\n\n= 3-5 working days\n= Free on orders over Â£500\n= Tracking sent when shipped\n\nAnything else I can help with?";
                        } else if (msgLower.includes('clean') || msgLower.includes('maintenance') || msgLower.includes('care')) {
                            helpfulResponse = "Care is easy:\n\n= **Rattan:** Wipe with damp cloth. Cover in harsh winters.\n= **Aluminium:** Just soapy water occasionally.\n= **Teak:** Oil annually or let weather to silver-grey.\n\nWould you like more tips?";
                        } else if (msgLower.includes('weather') || msgLower.includes('rain') || msgLower.includes('winter')) {
                            helpfulResponse = "Our furniture handles weather well:\n\n= **Rattan:** UV-tested 2000 hours. Cover in harsh winters.\n= **Aluminium:** 100% rust-proof, year-round outdoor use.\n= **Teak:** Naturally weather-resistant.\n\nA cover extends life significantly - shall I tell you more?";
                        } else {
                            helpfulResponse = "I'd be happy to help! I can assist with:\n\n= Warranty info\n= Delivery details\n= Care and maintenance\n= Product dimensions and specifications\n\nWhat would you like to know?";
                        }
                        
                        aiOutput = {
                            intent: 'question_answer',
                            response_text: helpfulResponse
                        };
                    }
                }



                
                // PRIORITY 3: Show products if we have context
                if (!aiOutput && hasWhitelist && hasContext) {
                    aiOutput = {
                        intent: 'product_recommendation',
                        intro_copy: `Based on your interest in ${ctx.material || ''} ${ctx.furnitureType || ''} furniture:`.trim().replace(/\s+/g, ' '),
                        selected_skus: session.currentWhitelist.slice(0, 3),
                        personalisation: '',
                        closing_copy: "Would any of these work for you?"
                    };
                    console.log(`âœ… Fallback: Showing products with context`);
                }
                
                // PRIORITY 4: Safety net
                if (!aiOutput) {
                    aiOutput = {
                        intent: 'clarification',
                        response_text: "I'd love to help! Are you looking for dining furniture, a lounge set, or perhaps a corner sofa?"
                    };
                    console.log(`âœ… Fallback: Safety net`);
                }
            }
        }

        // ============================================
        // VALIDATION WITH CONTEXT PRESERVATION
        // ============================================
        
        aiOutput = validateAIOutput(aiOutput, session.currentWhitelist, sessionId);
        
        if (!aiOutput) {
            const ctx = session.context;
            let fallbackText = "I'd love to help you find the perfect outdoor furniture.";
            
            if (ctx.material || ctx.seatCount) {
                fallbackText = `I'm still looking for ${ctx.material || 'furniture'}${ctx.seatCount ? ' for ' + ctx.seatCount + ' people' : ''}. Could you tell me if you prefer dining or lounge style?`;
            }
            
            aiOutput = {
                intent: 'clarification',
                response_text: fallbackText
            };
        }

        // Assemble response
        const finalResponse = await assembleResponse(aiOutput, sessionId, session);

        
        // ============================================
        // ENHANCED CONVERSATION HISTORY MANAGEMENT
        // ============================================
        
        // Build a rich context entry that includes what happened
        const userEntry = {
            role: 'user',
            content: message,
            timestamp: new Date().toISOString()
        };
        
        const assistantEntry = {
            role: 'assistant',
            content: finalResponse,
            metadata: {
                intent: aiOutput.intent,
                productsShown: aiOutput.selected_skus || [],
                timestamp: new Date().toISOString()
            }
        };
        
        session.conversationHistory.push(userEntry);
        session.conversationHistory.push(assistantEntry);
        
        // Track products shown in commercial state
        if (aiOutput.intent === 'product_recommendation' && aiOutput.selected_skus) {
            for (const sku of aiOutput.selected_skus) {
                if (!session.commercial.productsShown.includes(sku)) {
                    session.commercial.productsShown.push(sku);
                }
                // Track last product price for upsell calculations
                const product = productIndex.bySku[sku];
                if (product?.product_identity?.price_gbp) {
                    session.commercial.lastProductPrice = parseFloat(product.product_identity.price_gbp);
                }
            }
        }
        
        // Keep history manageable but preserve more context (last 12 messages = 6 exchanges)
        if (session.conversationHistory.length > 12) {
            // Keep first 2 messages (initial context) and last 10
            const firstMessages = session.conversationHistory.slice(0, 2);
            const recentMessages = session.conversationHistory.slice(-10);
            session.conversationHistory = [...firstMessages, ...recentMessages];
        }
        
        // Create a state summary for the AI to reference
        session.stateSummary = buildStateSummary(session);
        
        // ============================================
        // LOG CONVERSATION TO DATABASE
        // ============================================
        await logConversationMessage(sessionId, 'customer', message, {
            sentiment: session.commercial.sentiment
        });
        await logConversationMessage(sessionId, 'gwen', finalResponse, {
            intent: aiOutput.intent,
            productsShown: aiOutput.selected_skus || [],
            sentiment: session.commercial.sentiment
        });
        
        // ============================================
        // DETECT ESCALATION OFFERS - Track when Gwen offers to connect to support
        // ============================================
        const escalationOfferPatterns = [
            'connect you with our customer service',
            'connect you with our team',
            'connect you with support',
            'speak to someone',
            'speak to a person',
            'speak to our team',
            'would you like me to do that',
            'would you like that',
            'pass this to our team',
            'hand this over to',
            'get someone to help',
            'have our team contact you'
        ];
        
        const finalResponseLower = finalResponse.toLowerCase();
        const isOfferingEscalation = escalationOfferPatterns.some(p => finalResponseLower.includes(p));
        
        if (isOfferingEscalation) {
            console.log(`ðŸš¨ Escalation offered - setting flag for next response`);
            session.escalationOffered = true;
            session.escalationReason = `Customer inquiry: ${message.substring(0, 200)}`;
        }
        
        console.log(`ðŸ“¤ Response (${finalResponse.length} chars)`);
        console.log(`${'='.repeat(60)}\n`);
        
        res.json({
            response: finalResponse,
            sessionId: sessionId
        });
        
    } catch (error) {
        console.error('=ÂÅ’ Error:', error);
        // Log errors to dashboard too
        try {
            await logConversationMessage(sessionId, 'customer', message || 'unknown', { sentiment: 'error' });
            await logConversationMessage(sessionId, 'gwen', "Technical issue error", { intent: 'error', sentiment: 'error' });
        } catch(logErr) { /* ignore logging errors */ }
        
        res.status(500).json({
            response: "I apologize, but I'm having a technical issue. Please try again.",
            error: error.message
        });
    }
});

// ============================================
// DEBUG ENDPOINTS
// ============================================

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        version: '15.0 - Enhanced Intelligence + Pre-Order + Family Recognition',
        products: Object.keys(productIndex.bySku).length,
        inventory_records: inventoryData.length
    });
});

app.get('/debug-products', (req, res) => {
    const products = Object.values(productIndex.bySku).slice(0, 30).map(p => ({
        sku: p.product_identity?.sku,
        name: p.product_identity?.product_name,
        stock: getProductStock(p.product_identity?.sku)
    }));
    
    res.json({
        total: Object.keys(productIndex.bySku).length,
        in_stock: products.filter(p => p.stock > 0).length,
        sample: products
    });
});

// Debug endpoint to check inventory data specifically
app.get('/debug-inventory', (req, res) => {
    // Check if FARO-LOUNGE-SET is in inventory data
    const faroInInventory = inventoryData.find(i => i.sku === 'FARO-LOUNGE-SET');
    
    res.json({
        inventory_is_array: Array.isArray(inventoryData),
        inventory_length: inventoryData.length,
        sample_records: inventoryData.slice(0, 5),
        faro_in_inventory: faroInInventory || 'NOT FOUND',
        faro_stock_from_function: getProductStock('FARO-LOUNGE-SET')
    });
});

app.get('/debug-session/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.json({ error: 'Session not found' });
    res.json(session);
});

// Debug endpoint to test search directly
app.get('/debug-search', (req, res) => {
    const { type, material, seats } = req.query;
    console.log(`\nðŸ§ª DEBUG SEARCH: type=${type}, material=${material}, seats=${seats}`);
    
    const results = searchProducts({
        furnitureType: type || undefined,
        material: material || undefined,
        seatCount: seats ? parseInt(seats) : undefined
    });
    
    res.json({
        query: { type, material, seats },
        count: results.length,
        results: results
    });
});

// Debug endpoint to check specific product
app.get('/debug-product/:sku', (req, res) => {
    const sku = req.params.sku;
    const product = productIndex.bySku[sku];
    
    if (!product) {
        const allSkus = Object.keys(productIndex.bySku);
        const matches = allSkus.filter(s => s.toLowerCase().includes(sku.toLowerCase()));
        return res.json({
            error: `Product ${sku} not found`,
            did_you_mean: matches.slice(0, 5),
            total_products: allSkus.length
        });
    }
    
    // Check inventory data directly
    const invRecord = inventoryData.find(i => i.sku === sku);
    
    // Check PKC data
    const pkcStock = product?.logistics_and_inventory?.inventory?.available;
    
    const stock = getProductStock(sku);
    
    res.json({
        sku: sku,
        found: true,
        name: product.product_identity?.product_name,
        material_type: product.description_and_category?.material_type,
        taxonomy_type: product.description_and_category?.taxonomy_type,
        seats: product.specifications?.seats,
        seats_type: typeof product.specifications?.seats,
        stock_sources: {
            inventory_data: invRecord ? invRecord.available : 'NOT FOUND',
            pkc_data: pkcStock || 'NOT FOUND',
            function_result: stock
        },
        inventory_record: invRecord || 'NOT FOUND',
        would_pass_filters: {
            has_sku: !!product.product_identity?.sku,
            has_category: !!product.description_and_category?.primary_category,
            material_is_rattan: product.description_and_category?.material_type?.toLowerCase() === 'rattan',
            seats_gte_8: (parseInt(product.specifications?.seats) || 0) >= 8,
            is_lounge: product.description_and_category?.taxonomy_type?.toLowerCase().includes('lounge'),
            is_in_stock: stock > 0
        }
    });
});

// Debug endpoint to find all rattan products
app.get('/debug-rattan', (req, res) => {
    const allProducts = Object.values(productIndex.bySku);
    
    const rattanProducts = allProducts.filter(p => {
        const materialType = p.description_and_category?.material_type?.toLowerCase() || '';
        return materialType.includes('rattan');
    });
    
    const result = rattanProducts.map(p => ({
        sku: p.product_identity?.sku,
        name: p.product_identity?.product_name,
        material: p.description_and_category?.material_type,
        taxonomy: p.description_and_category?.taxonomy_type,
        seats: p.specifications?.seats,
        stock: getProductStock(p.product_identity?.sku)
    }));
    
    res.json({
        total_products: allProducts.length,
        rattan_count: rattanProducts.length,
        rattan_products: result
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

app.get('/widget', (req, res) => {
    res.sendFile(path.join(__dirname, 'widget.html'));
});

// ============================================
// CONVERSATION LOG DASHBOARD + API
// ============================================

app.get('/conversations', (req, res) => {
    res.sendFile(path.join(__dirname, 'conversations.html'));
});

// API: List all conversations (grouped by session)
app.get('/api/conversations', async (req, res) => {
    if (!pool) {
        return res.json({ conversations: [], error: 'No database connected' });
    }
    
    try {
        const result = await pool.query(`
            SELECT 
                session_id,
                COUNT(*) as message_count,
                MIN(created_at) as first_message_at,
                MAX(created_at) as last_message_at,
                (SELECT content FROM conversation_messages cm2 
                 WHERE cm2.session_id = cm.session_id 
                 AND cm2.role = 'customer' 
                 ORDER BY cm2.created_at ASC LIMIT 1
                ) as first_customer_message,
                COUNT(*) FILTER (WHERE products_shown IS NOT NULL AND products_shown != '[]') as products_shown_count,
                STRING_AGG(DISTINCT products_shown, ',') FILTER (WHERE products_shown IS NOT NULL) as products_shown,
                BOOL_OR(intent = 'checkout_flow') as has_checkout,
                BOOL_OR(content LIKE '%technical issue%' OR content LIKE '%apologize%') as has_errors,
                (SELECT sentiment FROM conversation_messages cm3 
                 WHERE cm3.session_id = cm.session_id 
                 AND cm3.sentiment IS NOT NULL 
                 ORDER BY cm3.created_at DESC LIMIT 1
                ) as final_sentiment,
                STRING_AGG(content, ' ') as all_messages_text
            FROM conversation_messages cm
            GROUP BY session_id
            ORDER BY MAX(created_at) DESC
            LIMIT 200
        `);
        
        res.json({ 
            conversations: result.rows,
            total: result.rows.length
        });
        
    } catch (error) {
        console.error('Failed to list conversations:', error.message);
        res.status(500).json({ error: error.message, conversations: [] });
    }
});

// API: Get all messages for a specific session
app.get('/api/conversations/:sessionId', async (req, res) => {
    if (!pool) {
        return res.json({ messages: [], error: 'No database connected' });
    }
    
    try {
        const result = await pool.query(`
            SELECT 
                role,
                content,
                intent,
                products_shown,
                sentiment,
                created_at
            FROM conversation_messages
            WHERE session_id = $1 ORDER BY created_at ASC
        `, [req.params.sessionId]);
        
        res.json({ 
            session_id: req.params.sessionId,
            messages: result.rows,
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('Failed to get conversation:', error.message);
        res.status(500).json({ error: error.message, messages: [] });
    }
});

// API: Get conversation stats
app.get('/api/conversation-stats', async (req, res) => {
    if (!pool) {
        return res.json({ error: 'No database connected' });
    }
    
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(DISTINCT session_id) as total_conversations,
                COUNT(*) as total_messages,
                COUNT(DISTINCT session_id) FILTER (
                    WHERE created_at > NOW() - INTERVAL '24 hours'
                ) as conversations_today
            FROM conversation_messages
        `);
        
        res.json(result.rows[0] || {});
        
    } catch (error) {
        console.error('Stats error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// =====================================================
const TEST_SCENARIOS_V2 = {
  "version": "2.0",
  "suites": {
    
    "fuzzy_product_matching": {
      "description": "Vague customer requests that require AI interpretation",
      "tests": [
        { "id": "FUZZY-001", "name": "Vague seating request", "input": "I need something to sit on outside", "expect_any": ["sofa", "chair", "lounge", "seating", "seat", "corner"], "must_not_contain": ["sorry", "cannot"] },
        { "id": "FUZZY-002", "name": "Relaxation focused", "input": "looking for somewhere to chill and have drinks with friends", "expect_any": ["lounge", "sofa", "corner", "seating", "set"], "must_not_contain": ["sorry", "cannot"] },
        { "id": "FUZZY-003", "name": "Sunbathing request", "input": "want to sunbathe in garden", "expect_any": ["lounger", "sun", "daybed", "recline"], "must_not_contain": ["sorry", "cannot"] },
        { "id": "FUZZY-004", "name": "Dining intent", "input": "want to eat outside with family", "expect_any": ["dining", "table", "eat", "meal", "food", "outdoor dining"], "must_not_contain": ["sorry", "cannot help"] },
        { "id": "FUZZY-005", "name": "Entertainment focused", "input": "hosting a bbq party next month need furniture", "expect_any": ["seat", "dining", "guest", "entertain", "set"], "must_not_contain": ["sorry"] },
        { "id": "FUZZY-006", "name": "Cozy corner request", "input": "want a cozy spot to read in garden", "expect_any": ["chair", "lounge", "corner", "seat", "comfortable"], "must_not_contain": ["sorry"] }
      ]
    },

    "seat_count": {
      "description": "Seating capacity requirements",
      "tests": [
        { "id": "SEAT-001", "name": "2 people", "input": "outdoor furniture for 2 people please", "expect_any": ["2", "two", "couple", "bistro", "pair", "loveseat"], "must_not_contain": ["8", "10", "large"] },
        { "id": "SEAT-002", "name": "4 people", "input": "need seating for 4 guests", "expect_any": ["4", "four", "seat"], "must_not_contain": ["sorry"] },
        { "id": "SEAT-003", "name": "6 people", "input": "furniture for family of 6", "expect_any": ["6", "six", "seat"], "must_not_contain": ["sorry"] },
        { "id": "SEAT-004", "name": "8+ people", "input": "large family gatherings of 8-10 people", "expect_any": ["8", "9", "10", "large", "corner", "modular"], "must_not_contain": ["sorry"] }
      ]
    },

    "material_questions": {
      "description": "Material durability and care",
      "tests": [
        { "id": "MAT-001", "name": "General durability", "input": "will this furniture last outside?", "expect_any": ["durable", "weather", "year", "last", "UV", "resistant", "quality", "built"], "must_not_contain": ["sorry"] },
        { "id": "MAT-002", "name": "Rattan longevity", "input": "how long does rattan furniture typically last?", "expect_any": ["year", "rattan", "polyrattan", "20", "durable", "last"], "must_not_contain": ["sorry"] },
        { "id": "MAT-003", "name": "Aluminium rust", "input": "does aluminium garden furniture rust?", "expect_any": ["rust", "aluminium", "aluminum", "no", "resistant", "won't", "doesn't"], "must_not_contain": ["sorry", "yes it does"] },
        { "id": "MAT-004", "name": "Teak care", "input": "how do I look after teak furniture?", "expect_any": ["teak", "oil", "clean", "silver", "maintain", "care"], "must_not_contain": ["sorry"] },
        { "id": "MAT-005", "name": "Material comparison", "input": "which is better rattan or aluminium?", "expect_any": ["rattan", "aluminium", "aluminum", "depend", "both", "prefer"], "must_not_contain": ["sorry", "cannot compare"] }
      ]
    },

    "weather_care": {
      "description": "Weather resistance questions",
      "tests": [
        { "id": "WEATHER-001", "name": "Rain concern", "input": "can I leave the furniture out in the rain?", "expect_any": ["rain", "water", "weather", "resistant", "cover", "yes", "protect"], "must_not_contain": ["sorry"] },
        { "id": "WEATHER-002", "name": "Winter storage", "input": "what should I do with furniture in winter?", "expect_any": ["winter", "store", "cover", "inside", "protect", "cushion"], "must_not_contain": ["sorry"] },
        { "id": "WEATHER-003", "name": "Year round", "input": "can furniture stay outside all year round?", "expect_any": ["year", "outside", "weather", "cover", "protect", "yes"], "must_not_contain": ["sorry"] },
        { "id": "WEATHER-004", "name": "UV fade", "input": "will sun fade the furniture colour?", "expect_any": ["UV", "sun", "fade", "colour", "color", "protect", "resistant"], "must_not_contain": ["sorry"] }
      ]
    },

    "warranty_delivery": {
      "description": "Service and delivery",
      "tests": [
        { "id": "WARRANTY-001", "name": "Warranty coverage", "input": "what warranty do you offer on furniture?", "expect_any": ["warranty", "year", "guarantee", "cover"], "must_not_contain": ["sorry"] },
        { "id": "DELIVERY-001", "name": "Delivery time", "input": "how long does delivery take?", "expect_any": ["deliver", "day", "week", "working", "5", "10"], "must_not_contain": ["sorry"] },
        { "id": "DELIVERY-002", "name": "Assembly", "input": "do you offer assembly?", "expect_any": ["assembl", "build", "set up", "service", "Â£69", "69.95"], "must_not_contain": ["sorry", "no"] },
        { "id": "DELIVERY-003", "name": "Scotland delivery", "input": "do you deliver to Scotland?", "expect_any": ["Scotland", "deliver", "postcode", "unfortunately", "unable", "currently"], "must_not_contain": ["sorry we cannot help"] }
      ]
    },

    "upsell_bundles": {
      "description": "Cross-sell opportunities",
      "tests": [
        { "id": "UPSELL-001", "name": "Cover suggestion", "input": "I've decided on the Faro set, anything else I need?", "expect_any": ["cover", "protect", "cushion", "accessory", "recommend", "bundle"], "must_not_contain": ["sorry"] },
        { "id": "UPSELL-002", "name": "Bundle offer", "input": "are there any deals if I buy multiple items?", "expect_any": ["bundle", "deal", "discount", "save", "%", "offer"], "must_not_contain": ["sorry"] },
        { "id": "UPSELL-003", "name": "Complete set", "input": "just looking at dining chairs right now", "expect_any": ["table", "set", "complete", "match", "go with"], "must_not_contain": ["sorry"] }
      ]
    },

    "specific_products": {
      "description": "Named product queries",
      "tests": [
        { "id": "PROD-001", "name": "Faro details", "input": "tell me about the Faro range", "expect_any": ["Faro", "seat", "rattan", "lounge", "corner"], "must_not_contain": ["sorry", "don't have"] },
        { "id": "PROD-002", "name": "Stockholm options", "input": "what Stockholm products do you have?", "expect_any": ["Stockholm", "dining", "aluminium", "aluminum"], "must_not_contain": ["sorry"] },
        { "id": "PROD-003", "name": "Barcelona info", "input": "is the Barcelona set any good?", "expect_any": ["Barcelona", "quality", "seat", "feature"], "must_not_contain": ["sorry", "don't know"] }
      ]
    },

    "price_budget": {
      "description": "Pricing and budget queries",
      "tests": [
        { "id": "PRICE-001", "name": "Price query", "input": "how much is the Faro set?", "expect_any": ["Â£", "price", "cost", "Faro", "from"], "must_not_contain": ["sorry", "cannot provide"] },
        { "id": "PRICE-002", "name": "Budget request", "input": "what can I get for under Â£1000?", "expect_any": ["Â£", "budget", "range", "option", "under"], "must_not_contain": ["sorry"] },
        { "id": "PRICE-003", "name": "Value concern", "input": "seems quite expensive, is it worth it?", "expect_any": ["quality", "value", "warranty", "last", "investment", "worth"], "must_not_contain": ["sorry"] },
        { "id": "PRICE-004", "name": "Payment options", "input": "can I pay in installments?", "expect_any": ["pay", "payment", "finance", "deposit", "option"], "must_not_contain": ["sorry", "cash only"] }
      ]
    },

    "space_dimensions": {
      "description": "Space planning queries",
      "tests": [
        { "id": "SPACE-001", "name": "Small space", "input": "I have a small balcony about 2m x 3m", "expect_any": ["small", "space", "balcony", "bistro", "compact", "fit"], "must_not_contain": ["sorry"] },
        { "id": "SPACE-002", "name": "Dimension request", "input": "what are the dimensions of the corner sofa?", "expect_any": ["dimension", "cm", "metre", "wide", "deep", "size", "measure"], "must_not_contain": ["sorry", "don't know"] },
        { "id": "SPACE-003", "name": "Will it fit", "input": "will a 6 seater set fit in a 4x5 metre patio?", "expect_any": ["fit", "space", "room", "yes", "should", "enough"], "must_not_contain": ["sorry"] }
      ]
    },

    "returns_policy": {
      "description": "Returns and exchanges",
      "tests": [
        { "id": "RETURN-001", "name": "Return policy", "input": "what's your return policy?", "expect_any": ["return", "14", "day", "refund", "policy"], "must_not_contain": ["sorry"] },
        { "id": "RETURN-002", "name": "Damaged item", "input": "what if my furniture arrives damaged?", "expect_any": ["damage", "contact", "photo", "replace", "48 hour", "report"], "must_not_contain": ["sorry"] },
        { "id": "RETURN-003", "name": "Exchange query", "input": "can I exchange if I change my mind?", "expect_any": ["exchange", "return", "change", "14", "original"], "must_not_contain": ["sorry"] }
      ]
    },

    "objection_handling": {
      "description": "Sales objections",
      "tests": [
        { "id": "OBJ-001", "name": "Price objection", "input": "that's more than I wanted to spend", "expect_any": ["understand", "budget", "value", "option", "quality", "alternative", "worth"], "must_not_contain": ["sorry", "can't help"] },
        { "id": "OBJ-002", "name": "Thinking about it", "input": "I need to think about it", "expect_any": ["understand", "question", "help", "decision", "happy", "here"], "must_not_contain": ["sorry", "goodbye"] },
        { "id": "OBJ-003", "name": "Competitor mention", "input": "I saw something similar cheaper at B&Q", "expect_any": ["quality", "warranty", "difference", "material", "compare", "value"], "must_not_contain": ["sorry", "buy from them"] }
      ]
    },

    "stock_availability": {
      "description": "Stock queries",
      "tests": [
        { "id": "STOCK-001", "name": "In stock query", "input": "is the Faro set in stock?", "expect_any": ["stock", "available", "delivery", "Faro"], "must_not_contain": ["sorry"] },
        { "id": "STOCK-002", "name": "Pre-order", "input": "when will the Stockholm be available?", "expect_any": ["available", "stock", "pre-order", "delivery", "week"], "must_not_contain": ["sorry", "never"] },
        { "id": "STOCK-003", "name": "Alternative request", "input": "that one is out of stock, what else do you have?", "expect_any": ["alternative", "similar", "option", "recommend", "instead"], "must_not_contain": ["sorry", "nothing"] }
      ]
    },

    "use_case_specific": {
      "description": "Special use cases",
      "tests": [
        { "id": "USE-001", "name": "Commercial", "input": "do you supply to hotels and restaurants?", "expect_any": ["commercial", "business", "trade", "bulk", "contact", "volume"], "must_not_contain": ["sorry", "residential only"] },
        { "id": "USE-002", "name": "Gift purchase", "input": "buying as a gift for my parents", "expect_any": ["gift", "lovely", "great", "choice", "popular"], "must_not_contain": ["sorry"] },
        { "id": "USE-003", "name": "Rental property", "input": "need furniture for rental property, something durable", "expect_any": ["durable", "robust", "low maintenance", "weather", "quality"], "must_not_contain": ["sorry"] }
      ]
    },

    "cushion_fabric": {
      "description": "Fabric care",
      "tests": [
        { "id": "CUSH-001", "name": "Cushion washing", "input": "can I machine wash the cushion covers?", "expect_any": ["wash", "cushion", "hand", "gentle", "clean"], "must_not_contain": ["sorry"] },
        { "id": "CUSH-002", "name": "Fabric samples", "input": "can I get fabric swatches?", "expect_any": ["swatch", "sample", "fabric", "free", "send"], "must_not_contain": ["sorry", "no"] },
        { "id": "CUSH-003", "name": "Spill handling", "input": "what if I spill wine on the cushions?", "expect_any": ["spill", "clean", "stain", "wipe", "blot"], "must_not_contain": ["sorry", "ruined"] }
      ]
    },

    "edge_cases": {
      "description": "Unusual inputs",
      "tests": [
        { "id": "EDGE-001", "name": "Simple greeting", "input": "Hi there", "expect_any": ["hello", "hi", "help", "welcome", "looking"], "must_not_contain": ["error", "cannot"] },
        { "id": "EDGE-002", "name": "Gibberish", "input": "asdfghjkl", "expect_any": ["help", "understand", "looking", "assist", "question"], "must_not_contain": ["error", "crash"] },
        { "id": "EDGE-003", "name": "Off-topic", "input": "what's the weather like today?", "expect_any": ["outdoor", "furniture", "help", "garden", "weather"], "must_not_contain": ["error"] },
        { "id": "EDGE-004", "name": "Thank you", "input": "thank you for your help", "expect_any": ["welcome", "pleasure", "help", "question", "happy"], "must_not_contain": ["error", "sorry"] }
      ]
    },

    "sustainability": {
      "description": "Eco questions",
      "tests": [
        { "id": "ECO-001", "name": "Environmental", "input": "is your furniture environmentally friendly?", "expect_any": ["sustainable", "FSC", "recycle", "environment", "responsible", "eco"], "must_not_contain": ["sorry", "no"] },
        { "id": "ECO-002", "name": "Material sourcing", "input": "where does your teak come from?", "expect_any": ["teak", "source", "FSC", "certified", "sustainable"], "must_not_contain": ["sorry", "don't know"] }
      ]
    }
  }
};


// ============================================
// TEST RUNNER FUNCTIONS
// ============================================

function checkTestResult(response, scenario) {
  const lowerResponse = response.toLowerCase();
  
  // Check expect_any (at least one term must be found)
  let expectAnyPassed = true;
  let foundTerms = [];
  let missingTerms = [];
  
  if (scenario.expect_any && scenario.expect_any.length > 0) {
    let anyFound = false;
    for (const term of scenario.expect_any) {
      if (lowerResponse.includes(term.toLowerCase())) {
        foundTerms.push(term);
        anyFound = true;
      } else {
        missingTerms.push(term);
      }
    }
    expectAnyPassed = anyFound;
  }
  
  // Check must_not_contain
  let mustNotPassed = true;
  let violations = [];
  
  if (scenario.must_not_contain && scenario.must_not_contain.length > 0) {
    for (const term of scenario.must_not_contain) {
      if (lowerResponse.includes(term.toLowerCase())) {
        violations.push(term);
        mustNotPassed = false;
      }
    }
  }
  
  return {
    passed: expectAnyPassed && mustNotPassed,
    foundTerms,
    missingTerms,
    violations,
    expectAnyPassed,
    mustNotPassed
  };
}

// ============================================
// TEST ENDPOINTS
// ============================================

app.get('/run-tests', async (req, res) => {
  const format = req.query.format || 'html';
  const requestedSuites = req.query.suite ? req.query.suite.split(',') : null;
  
  console.log('\nðŸ§ª =Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â');
  console.log('ðŸ§ª GWEN TEST SUITE V2');
  console.log('ðŸ§ª =Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â\n');
  
  const results = [];
  const suites = TEST_SCENARIOS_V2.suites;
  
  // Filter suites if specific ones requested
  const suitesToRun = requestedSuites 
    ? Object.keys(suites).filter(s => requestedSuites.includes(s))
    : Object.keys(suites);
  
  for (const suiteName of suitesToRun) {
    const suite = suites[suiteName];
    console.log(`\nðŸ“‹ Suite: ${suiteName}`);
    
    for (const test of suite.tests) {
      console.log(`ðŸ”„ ${test.id}: ${test.name}`);
      const startTime = Date.now();
      
      try {
        // Create fresh session for each test
        const testSessionState = {
          messageCount: 1,
          established: {},
          commercial: {},
          availableSkus: []
        };
        
        const systemPrompt = buildSystemPrompt(testSessionState);
        
        // Call OpenAI
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: test.input }
          ],
           tools: aiTools,
          tool_choice: 'auto',
          max_tokens: 800,
          temperature: 0.7
        });
        
        let response = completion.choices[0].message;
        let toolsUsed = [];
        
        // Handle tool calls if any
        if (response.tool_calls && response.tool_calls.length > 0) {
          const toolMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: test.input },
            response
          ];
          
          for (const toolCall of response.tool_calls) {
            toolsUsed.push(toolCall.function.name);
            const args = JSON.parse(toolCall.function.arguments);
            let toolResult;
            
            if (toolCall.function.name === 'search_products') {
              toolResult = searchProducts(args);
            } else if (toolCall.function.name === 'get_material_info') {
              toolResult = materialInfo[args.material] || { error: 'Unknown material' };
            } else {
              toolResult = { error: 'Unknown tool' };
            }
            
            toolMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult)
            });
          }
          
          const followUp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: toolMessages,
            max_tokens: 800,
            temperature: 0.7
          });
          
          response = followUp.choices[0].message;
        }
        
        const responseText = response.content || '';
        const responseTime = Date.now() - startTime;
        const responseLower = responseText.toLowerCase();
        
        // Check assertions
        let passed = true;
        let foundTerms = [];
        let missingTerms = [];
        let violations = [];
        
        // Check expect_any (at least one must match)
        if (test.expect_any && test.expect_any.length > 0) {
          const found = test.expect_any.filter(term => 
            responseLower.includes(term.toLowerCase())
          );
          foundTerms = found;
          if (found.length === 0) {
            passed = false;
            missingTerms = test.expect_any;
          }
        }
        
        // Check must_not_contain
        if (test.must_not_contain && test.must_not_contain.length > 0) {
          for (const term of test.must_not_contain) {
            if (responseLower.includes(term.toLowerCase())) {
              passed = false;
              violations.push(term);
            }
          }
        }
        
        const status = passed ? 'âœ… PASSED' : '=ÂÅ’ FAILED';
        console.log(`${status} (${responseTime}ms)`);
        
        if (!passed && missingTerms.length > 0) {
          console.log(`None found from: ${missingTerms.join(', ')}`);
        }
        if (violations.length > 0) {
          console.log(`Violations: ${violations.join(', ')}`);
        }
        
        results.push({
          suite: suiteName,
          id: test.id,
          name: test.name,
          input: test.input,
          passed,
          responseTime,
          foundTerms,
          missingTerms,
          violations,
          toolsUsed,
          response: responseText.substring(0, 500)
        });
        
      } catch (error) {
        console.log(`=ÂÅ’ ERROR: ${error.message}`);
        results.push({
          suite: suiteName,
          id: test.id,
          name: test.name,
          input: test.input,
          passed: false,
          error: error.message,
          responseTime: Date.now() - startTime
        });
      }
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 600));
    }
  }
  
  // Calculate stats
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const passRate = ((passed / total) * 100).toFixed(1);
  
  console.log(`\nðŸ§ª =Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â`);
  console.log(`ðŸ§ª RESULTS: ${passed}/${total} (${passRate}%)`);
  console.log(`ðŸ§ª =Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â=Â\n`);
  
  if (format === 'json') {
    return res.json({ passed, total, passRate, results });
  }
  
  // Generate HTML report
  // Build results object for HTML generator
  const suiteResults = {};
  for (const suiteName of suitesToRun) {
    const suiteTests = results.filter(r => r.suite === suiteName);
    suiteResults[suiteName] = {
      total: suiteTests.length,
      passed: suiteTests.filter(t => t.passed).length,
      tests: suiteTests.map(t => ({
        id: t.id,
        name: t.name,
        input: t.input,
        passed: t.passed,
        responseTime: t.responseTime,
        found: t.foundTerms,
        missing: t.missingTerms,
        violations: t.violations,
        error: t.error,
        response: t.response
      }))
    };
  }
  
  const html = generateTestReportHTML({
    timestamp: new Date().toISOString(),
    summary: { total, passed, failed: total - passed, passRate: passRate + '%' },
    suites: suiteResults
  });
  res.send(html);
});

// Single test endpoint
app.get('/test-single', async (req, res) => {
  const input = req.query.input || req.query.q || 'outdoor furniture for 4 people';
  
  console.log(`\nðŸ§ª Single test: "${input}"`);
  
  try {
    const systemPrompt = buildSystemPrompt ? buildSystemPrompt() : '';
    
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: input }
    ];
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      tools: aiTools,
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 600
    });
    
    let response = completion.choices[0].message;
    let toolsCalled = [];
    let finalContent = response.content || '';
    
    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolMessages = [...messages, response];
      
      for (const toolCall of response.tool_calls) {
        const funcName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        toolsCalled.push({ function: funcName, args });
        
        let toolResult = { error: "Unknown function" };
        
        if (funcName === "search_products") {
          toolResult = searchProducts(args);
        }
        
        toolMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult)
        });
      }
      
      const finalCompletion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: toolMessages,
        temperature: 0.4,
        max_tokens: 600
      });
      
      finalContent = finalCompletion.choices[0].message.content || '';
    }
    
    res.json({
      input,
      toolsCalled,
      response: finalContent
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// HTML Report Generator
function generateTestReportHTML(results) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Gwen Test Results</title>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 20px; }
    .header h1 { margin: 0 0 10px 0; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
    .stat { background: white; padding: 20px; border-radius: 10px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stat h3 { margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; }
    .stat .value { font-size: 32px; font-weight: bold; }
    .passed { color: #10b981; }
    .failed { color: #ef4444; }
    .suite { background: white; border-radius: 10px; margin-bottom: 15px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .suite-header { padding: 15px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
    .suite-name { font-weight: 600; text-transform: uppercase; font-size: 14px; }
    .suite-stats { font-size: 14px; color: #666; }
    .test { padding: 12px 20px; border-bottom: 1px solid #f1f5f9; }
    .test:last-child { border-bottom: none; }
    .test-row { display: flex; align-items: center; gap: 12px; cursor: pointer; }
    .test-status { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; }
    .test-status.pass { background: #dcfce7; color: #10b981; }
    .test-status.fail { background: #fee2e2; color: #ef4444; }
    .test-info { flex: 1; }
    .test-id { font-weight: 600; font-size: 13px; }
    .test-name { color: #666; font-size: 13px; }
    .test-time { color: #999; font-size: 12px; }
    .test-details { display: none; margin-top: 12px; padding: 12px; background: #f8fafc; border-radius: 8px; font-size: 13px; }
    .test-details.show { display: block; }
    .detail-row { margin-bottom: 8px; }
    .detail-label { font-weight: 600; color: #374151; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin: 2px; }
    .badge.found { background: #dcfce7; color: #15803d; }
    .badge.missing { background: #fef3c7; color: #b45309; }
    .badge.violation { background: #fee2e2; color: #b91c1c; }
    .response-text { background: white; padding: 10px; border-radius: 6px; margin-top: 8px; white-space: pre-wrap; font-size: 12px; color: #374151; max-height: 200px; overflow-y: auto; }
    .actions { margin-top: 20px; text-align: center; }
    .btn { display: inline-block; padding: 10px 20px; background: #10b981; color: white; text-decoration: none; border-radius: 6px; margin: 5px; }
    .btn:hover { background: #059669; }
  </style>
</head>
<body>
  <div class="header">
    <h1>ðŸ§ª Gwen Test Results</h1>
    <p>Run at: ${results.timestamp}</p>
  </div>
  
  <div class="summary">
    <div class="stat">
      <h3>Total Tests</h3>
      <div class="value">${results.summary.total}</div>
    </div>
    <div class="stat">
      <h3>Passed</h3>
      <div class="value passed">${results.summary.passed}</div>
    </div>
    <div class="stat">
      <h3>Failed</h3>
      <div class="value failed">${results.summary.failed}</div>
    </div>
    <div class="stat">
      <h3>Pass Rate</h3>
      <div class="value" style="color: ${parseFloat(results.summary.passRate) >= 70 ? '#10b981' : '#ef4444'}">${results.summary.passRate}</div>
    </div>
  </div>
  
  ${Object.entries(results.suites).map(([suiteName, suite]) => `
  <div class="suite">
    <div class="suite-header">
      <span class="suite-name">${suiteName.replace(/_/g, ' ')}</span>
      <span class="suite-stats">${suite.passed}/${suite.total} passed</span>
    </div>
    ${suite.tests.map(test => `
    <div class="test">
      <div class="test-row" onclick="this.nextElementSibling.classList.toggle('show')">
        <div class="test-status ${test.passed ? 'pass' : 'fail'}">${test.passed ? 'âœ”' : 'âœ—'}</div>
        <div class="test-info">
          <span class="test-id">${test.id}</span>
          <span class="test-name">- ${test.name}</span>
        </div>
        <span class="test-time">${test.responseTime || 0}ms</span>
      </div>
      <div class="test-details">
        <div class="detail-row">
          <span class="detail-label">Input:</span> "${test.input}"
        </div>
        ${test.found && test.found.length > 0 ? `
        <div class="detail-row">
          <span class="detail-label">Found:</span>
          ${test.found.map(t => `<span class="badge found">${t}</span>`).join('')}
        </div>
        ` : ''}
        ${test.missing && test.missing.length > 0 && (!test.found || test.found.length === 0) ? `
        <div class="detail-row">
          <span class="detail-label">Expected one of:</span>
          ${test.missing.map(t => `<span class="badge missing">${t}</span>`).join('')}
        </div>
        ` : ''}
        ${test.violations && test.violations.length > 0 ? `
        <div class="detail-row">
          <span class="detail-label">Violations:</span>
          ${test.violations.map(t => `<span class="badge violation">${t}</span>`).join('')}
        </div>
        ` : ''}
        ${test.error ? `
        <div class="detail-row">
          <span class="detail-label" style="color: #ef4444;">Error:</span> ${test.error}
        </div>
        ` : ''}
        ${test.response ? `
        <div class="detail-row">
          <span class="detail-label">Response:</span>
          <div class="response-text">${test.response.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </div>
        ` : ''}
      </div>
    </div>
    `).join('')}
  </div>
  `).join('')}
  
  <div class="actions">
    <a href="/run-tests" class="btn">ðŸ”„ Run Again</a>
    <a href="/run-tests?format=json" class="btn">ðŸ“Š JSON Results</a>
    <a href="/test-single?input=I need 6 seater rattan furniture" class="btn">ðŸ§ª Test Single</a>
  </div>
</body>
</html>`;
}



// ============================================
// SERVER STARTUP
// ============================================

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`ðŸš€ GWEN v14.0 - Conversation + Server Rendering`);
    console.log(`   Products: ${Object.keys(productIndex.bySku).length}`);
    console.log(`   Inventory: ${inventoryData.length} records`);
    console.log(`   OpenAI: ${process.env.OPENAI_API_KEY ? 'âœ…' : '=ÂÅ’'}`);
    console.log(`   Shopify: ${SHOPIFY_ACCESS_TOKEN ? 'âœ…' : 'âš Ã¯Â¸Â'}`);
    console.log(`${'='.repeat(60)}\n`);
});

module.exports = app;