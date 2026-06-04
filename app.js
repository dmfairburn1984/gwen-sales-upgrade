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
        console.log('❌ Email configuration ERROR:', error.message);
        console.log('   EMAIL_USER:', process.env.EMAIL_USER ? '✅ Set' : '❌ Missing');
        console.log('   EMAIL_PASSWORD:', process.env.EMAIL_PASSWORD ? '✅ Set' : '❌ Missing');
    } else {
        console.log('✅ Email server ready - can send escalations');
    }
});

// ============================================
// ESCALATION EMAIL FUNCTION
// ============================================

async function sendEscalationEmail(customerEmail, customerName, reason, conversationHistory, productsDiscussed = []) {
    // Use environment variable, fallback to help@mint-outdoor.com
    const supportEmail = process.env.ESCALATION_EMAIL || 'help@mint-outdoor.com';
    
    console.log(`📧 ============================================`);
    console.log(`📧 ESCALATION EMAIL ATTEMPT`);
    console.log(`📧 To: ${supportEmail}`);
    console.log(`📧 From: ${process.env.EMAIL_USER}`);
    console.log(`📧 Customer: ${customerEmail}`);
    console.log(`📧 Reason: ${reason.substring(0, 100)}...`);
    console.log(`📧 ============================================`);
    
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
                ? `• ${product.product_identity?.product_name} (${sku}) - £${product.product_identity?.price_gbp}`
                : `• ${sku}`;
          }).join('\n')
        : 'No specific products discussed';
    
    const emailContent = {
        from: `"Gwen Sales Agent" <${process.env.EMAIL_USER}>`,
        to: supportEmail,
        replyTo: customerEmail || process.env.EMAIL_USER,
        subject: `🚨 Gwen Escalation: Customer needs help - ${reason.substring(0, 50)}`,
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
            console.log(`❌ Email credentials not configured`);
            console.log(`   EMAIL_USER: ${process.env.EMAIL_USER ? 'Set' : 'MISSING'}`);
            console.log(`   EMAIL_PASSWORD: ${process.env.EMAIL_PASSWORD ? 'Set' : 'MISSING'}`);
            return { success: false, message: 'Email credentials not configured' };
        }
        
        const info = await emailTransporter.sendMail(emailContent);
        console.log(`✅ ESCALATION EMAIL SENT SUCCESSFULLY`);
        console.log(`   Message ID: ${info.messageId}`);
        console.log(`   To: ${supportEmail}`);
        console.log(`   Customer: ${customerEmail}`);
        return { success: true, message: 'Escalation email sent', messageId: info.messageId };
        
    } catch (error) {
        console.log(`❌ ESCALATION EMAIL FAILED`);
        console.log(`   Error: ${error.message}`);
        console.log(`   Code: ${error.code || 'N/A'}`);
        console.log(`   Response: ${error.response || 'N/A'}`);
        
        // Log more details for common errors
        if (error.code === 'EAUTH') {
            console.log(`   💡 Fix: Check EMAIL_PASSWORD - may need App Password from Google`);
            console.log(`   💡 Go to: https://myaccount.google.com/apppasswords`);
        }
        if (error.code === 'ESOCKET' || error.code === 'ECONNECTION') {
            console.log(`   💡 Fix: Network/firewall issue - check Heroku can reach smtp.gmail.com`);
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
        console.log('⚠️ No database - conversation logging disabled');
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
        
        console.log('✅ Conversation logging tables ready');
    } catch (error) {
        console.error('⚠️ Failed to create conversation tables:', error.message);
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
        console.error('⚠️ Failed to log conversation:', error.message);
        // Don't throw - logging failure should never break the chat
    }
}

const ENABLE_SALES_MODE = process.env.ENABLE_SALES_MODE === 'true';
const sessions = new Map();

// Shopify configuration
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_URL || 'bb69ce-b5.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// Phase 0.1: intel API (host-side, read-only) for verified order delivery status.
// Reuses the existing :3850 endpoints; CHATBOT_API_KEY is a Coolify env var.
const INTEL_API_URL = process.env.INTEL_API_URL || 'http://10.0.1.1:3850';
const INTEL_API_KEY = process.env.CHATBOT_API_KEY || '';

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
        console.log(`✅ Loaded ${filename}`);
        return parsedData;
    } catch (error) {
        console.error(`❌ Failed to load ${filename}: ${error.message}`);
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

// ============================================
// PO SHIPPING PLAN DATA - For delivery estimates
// ============================================
const poShippingPlan = loadDataFile('PO_List_Shipping_Plan_SKU.json', { poList: [] });
console.log(`📦 PO Shipping Plan: ${poShippingPlan.poList?.length || 0} purchase orders loaded`);

console.log(`📦 Inventory data type: ${typeof rawInventoryData}`);
console.log(`📦 Inventory is array after processing: ${Array.isArray(inventoryData)}`);
console.log(`📦 Inventory length: ${inventoryData.length}`);

// Check FARO specifically
const faroInventory = inventoryData.find(i => i.sku === 'FARO-LOUNGE-SET');
if (faroInventory) {
    console.log(`✅ FARO-LOUNGE-SET in inventory: available=${faroInventory.available}`);
} else {
    console.log(`❌ FARO-LOUNGE-SET NOT in inventory array`);
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

console.log(`📦 Indexed ${Object.keys(productIndex.bySku).length} products`);
console.log(`📦 Inventory records: ${inventoryData.length}`);

// Verify specific product exists
const testProduct = productIndex.bySku['FARO-LOUNGE-SET'];
if (testProduct) {
    console.log(`✅ FARO-LOUNGE-SET found in index:`);
    console.log(`   - Name: ${testProduct.product_identity?.product_name}`);
    console.log(`   - Material: ${testProduct.description_and_category?.material_type}`);
    console.log(`   - Taxonomy: ${testProduct.description_and_category?.taxonomy_type}`);
    console.log(`   - Seats: ${testProduct.specifications?.seats} (type: ${typeof testProduct.specifications?.seats})`);
} else {
    console.log(`❌ FARO-LOUNGE-SET NOT FOUND in index!`);
    console.log(`   Sample SKUs: ${Object.keys(productIndex.bySku).slice(0, 5).join(', ')}`);
}

// Count rattan products
const rattanCount = Object.values(productIndex.bySku).filter(p => 
    p.description_and_category?.material_type?.toLowerCase() === 'rattan'
).length;
console.log(`📦 Rattan products: ${rattanCount}`);

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
    
    // ============================================
    // v16.0: IMPROVED FAMILY DETECTION
    // Sort terms by length DESCENDING so longer/more specific names match first
    // Use word boundary matching to prevent "cover" matching "cove" etc.
    // ============================================
    const allFamilyNames = Object.keys(PRODUCT_FAMILIES);
    const allSearchTerms = [...allFamilyNames, ...Object.keys(FAMILY_ALIASES)];
    
    // Sort longest first so "STOCKHOLM" matches before "STOCK"
    allSearchTerms.sort((a, b) => b.length - a.length);
    
    // Words that should NEVER match as a product family name
    const blockedTerms = ['cover', 'covers', 'cushion', 'cushions', 'box', 'set', 
                          'table', 'chair', 'garden', 'the', 'for', 'and', 'not',
                          'delivery', 'assembly', 'collection', 'headrest', 'ion'];
    
    for (const term of allSearchTerms) {
        const termLower = term.toLowerCase();
        if (termLower.length < 3) continue;
        
        // Skip terms that are common words to prevent false matches
        if (blockedTerms.includes(termLower)) continue;
        
        // Use word boundary matching: "palma" should match in "palma cover" 
        // but "cove" should NOT match in "cover"
        const regex = new RegExp(`\\b${termLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(msgLower)) {
            result.family = FAMILY_ALIASES[term] || term;
            console.log(`Family parser: matched term "${term}" -> family=${result.family}`);
            break;
        }
    }
    
    if (!result.family) return result;
    
    // ============================================
    // TYPE DETECTION - What kind of product within the family?
    // ============================================
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
// Now checks BOTH demand dashboard AND PO shipping plan
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
    
    // CHECK 1: Demand plan dashboard
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
    
    // CHECK 2: PO Shipping Plan - find any future PO with this SKU and available stock
    if (poShippingPlan && poShippingPlan.poList) {
        const today = new Date();
        
        for (const po of poShippingPlan.poList) {
            const skuData = po.skus?.[sku];
            if (!skuData || skuData.planned <= 0 || skuData.available <= 0) continue;
            
            // Get ETA warehouse date
            const etaStr = po.delayedETAWarehouse || po.originalETAWarehouse;
            if (!etaStr) continue;
            
            const etaWarehouse = new Date(etaStr);
            
            // Skip POs that already arrived (stock should already be in inventory)
            if (po.poArrived) {
                const arrivedDate = new Date(po.poArrived);
                if (arrivedDate < today) continue;
            }
            
            // This is a future PO with available stock - it's a pre-order item
            // Calculate delivery as ETA Warehouse + 10 working days
            let deliveryDate = new Date(etaWarehouse);
            let workingDaysAdded = 0;
            while (workingDaysAdded < 10) {
                deliveryDate.setDate(deliveryDate.getDate() + 1);
                const dayOfWeek = deliveryDate.getDay();
                if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                    workingDaysAdded++;
                }
            }
            
            const deliveryStr = deliveryDate.toLocaleDateString('en-GB', { 
                day: 'numeric', month: 'long', year: 'numeric' 
            });
            const monthStr = etaWarehouse.toLocaleDateString('en-GB', { 
                month: 'long', year: 'numeric' 
            });
            
            console.log(`📦 PO pre-order found for ${sku}: PO ${po.purchaseOrderNo}, ETA warehouse ${etaStr.substring(0,10)}, delivery by ${deliveryStr}, ${skuData.available} units available`);
            
            return {
                status: 'pre_order',
                expectedMonth: monthStr,
                expectedQuantity: skuData.available,
                estimatedDelivery: deliveryStr,
                poNumber: po.purchaseOrderNo,
                message: `Available for pre-order! Estimated delivery by ${deliveryStr}`,
                canOrder: true
            };
        }
    }
    
    return { status: 'unknown', message: 'Contact us for availability', canOrder: true };
}
// ============================================
// DELIVERY ESTIMATION - Uses PO Shipping Plan
// ============================================

function addWorkingDays(date, days) {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
        result.setDate(result.getDate() + 1);
        const dayOfWeek = result.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            added++;
        }
    }
    return result;
}

function getDeliveryEstimate(sku) {
    const today = new Date();
    const estimates = [];
    
    if (!poShippingPlan.poList || poShippingPlan.poList.length === 0) {
        return null;
    }
    
    for (const po of poShippingPlan.poList) {
        // Check if this PO contains our SKU with planned stock
        const skuData = po.skus?.[sku];
        if (!skuData || skuData.planned <= 0) continue;
        
        // Skip if no available units left on this PO
        if (skuData.available <= 0) continue;
        
        // Get the ETA warehouse date (use delayed if available, otherwise original)
        const etaStr = po.delayedETAWarehouse || po.originalETAWarehouse;
        if (!etaStr) continue;
        
        const etaWarehouse = new Date(etaStr);
        
        // If already arrived, check if it has already been processed
        if (po.poArrived) {
            const arrivedDate = new Date(po.poArrived);
            // If arrived and in the past, this stock should already be in inventory
            if (arrivedDate < today) {
                const deliveryDate = addWorkingDays(today, 5);
                estimates.push({
                    poNumber: po.purchaseOrderNo,
                    status: 'in_warehouse',
                    etaWarehouse: arrivedDate,
                    estimatedDelivery: deliveryDate,
                    availableUnits: skuData.available,
                    message: `In stock — estimated delivery by ${deliveryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
                });
                continue;
            }
        }
        
        // Future PO - calculate delivery as ETA Warehouse + 10 working days
        if (etaWarehouse > today) {
            const estimatedDelivery = addWorkingDays(etaWarehouse, 10);
            estimates.push({
                poNumber: po.purchaseOrderNo,
                status: 'incoming',
                etaWarehouse: etaWarehouse,
                estimatedDelivery: estimatedDelivery,
                availableUnits: skuData.available,
                message: `Available for pre-order — estimated delivery by ${estimatedDelivery.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
            });
        }
    }
    
    // Sort by earliest delivery date
    estimates.sort((a, b) => a.estimatedDelivery - b.estimatedDelivery);
    
    if (estimates.length === 0) return null;
    
    // Return the earliest available delivery
    const earliest = estimates[0];
    const totalAvailable = estimates.reduce((sum, e) => sum + e.availableUnits, 0);
    
    return {
        earliest: earliest,
        allShipments: estimates,
        totalAvailableAcrossPos: totalAvailable,
        summary: earliest.message
    };
}

console.log(`📦 Delivery estimation function ready`);

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
        console.log(`📊 getProductStock(${sku}): inventory=${stockFromInventory}, PKC=${stockFromPKC}, using=${finalStock}`);
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
    
    console.log(`🔍 Looking for product: "${searchTerm}"`);
    console.log(`   Products shown this session: [${productsShown.join(', ')}]`);
    
    // v16.0: Exclude service/delivery SKUs from ALL product searches
    const excludedSkus = ['2-PERSON-DELIVERY', 'ASSEMBLY-SERVICE', 'DELIVERY-CHARGE', 'ASSEMBLY-ADD-ON', 'COLLECTION-FEE'];
    
    // PRIORITY 1: Check recently shown products first
    if (productsShown.length > 0) {
        for (const sku of productsShown) {
            if (excludedSkus.includes(sku)) continue;
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
                    console.log(`   ✅ Found in shown products: ${sku}`);
                    return { sku, product, source: 'shown' };
                }
            }
        }
    }
    
    // v16.0: PRIORITY 1.5 - Check via PRODUCT_FAMILIES map (most reliable for family names)
    const resolvedFamily = resolveFamily(searchTerm);
    if (resolvedFamily) {
        const familyData = PRODUCT_FAMILIES[resolvedFamily];
        if (familyData) {
            // Determine if customer is asking for a cover specifically
            const wantsCover = /\bcover[s]?\b/i.test(searchTerm);
            const searchOrder = wantsCover 
                ? [...(familyData.covers || []), ...(familyData.furniture || [])]
                : [...(familyData.furniture || []), ...(familyData.covers || [])];
            
            for (const sku of searchOrder) {
                if (excludedSkus.includes(sku)) continue;
                const stock = getProductStock(sku);
                if (stock > 0) {
                    const product = productIndex.bySku[sku];
                    if (product) {
                        console.log(`   ✅ Found via family map: ${sku} (family: ${resolvedFamily}, wantsCover: ${wantsCover})`);
                        return { sku, product, source: 'family_map' };
                    }
                }
            }
        }
    }
    
    // PRIORITY 2: Search entire database (excluding service SKUs)
    for (const [sku, product] of Object.entries(productIndex.bySku)) {
        // v16.0: Skip service/delivery SKUs
        if (excludedSkus.includes(sku)) continue;
        
        const name = product.product_identity?.product_name?.toLowerCase() || '';
        const skuLower = sku.toLowerCase();
        const family = product.product_identity?.product_family?.toLowerCase() || '';
        
        if (name.includes(searchTerm) || 
            skuLower.includes(searchTerm.replace(/\s+/g, '-')) ||
            family.includes(searchTerm) ||
            searchTerm.includes(family)) {
            console.log(`   ✅ Found in database: ${sku}`);
            return { sku, product, source: 'database' };
        }
    }
    
    console.log(`   ❌ Product not found: "${searchTerm}"`);
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
    
    console.log(`🔍 Finding accessories for family: "${searchFamily}"`);
    
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
        
        console.log(`   ✅ Found accessory: ${sku}`);
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
        console.log(`⚠️ No product data for SKU: ${sku}`);
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
        console.log(`📐 Missing dimensions for ${sku}`);
        return {
            type: 'dimension_missing',
            card: null,
            fallbackMessage: `I don't have the exact footprint sizes for the ${name} to hand, but we usually have detailed dimension diagrams on the product page here if you'd like to check:\n\n<a href="${productUrl}" target="_blank" style="color:#2E6041; text-decoration:underline;">— View ${name} →</a>\n\nOtherwise, please give me your email and I'll have our customer service manager get back to you within today or latest first thing tomorrow.`,
            productUrl: productUrl,
            productName: name,
            sku: sku
        };
    }
    
    // Build dimension card
    let card = `\n📐 **${name} - Dimensions**\n\n`;
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
    
    card += `\n<a href="${productUrl}" target="_blank" style="color:#2E6041; text-decoration:underline;">— View detailed dimension diagram →</a>\n`;
    
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
        return `\n📦 **Delivery Boxes:** Contact us for box dimensions - we'll measure and confirm before delivery.\n`;
    }
    
    // Check if any boxes have dimensions
    const boxesWithDimensions = components.filter(c => 
        c.box_dimensions_cm?.length || c.box_dimensions_cm?.width || c.box_dimensions_cm?.height
    );
    
    if (boxesWithDimensions.length === 0) {
        return `\n📦 **Delivery Boxes:** This set arrives in ${components.length} box${components.length > 1 ? 'es' : ''}. Contact us for exact box dimensions.\n`;
    }
    
    let boxCard = `\n📦 **Delivery Boxes:**\n`;
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
            boxCard += `**Box ${index + 1}:** ${dims.length}cm × ${dims.width}cm × ${dims.height}cm\n`;
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
    console.log(`📐 Filtering for space: ${maxWidth}cm × ${maxLength}cm`);
    
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
            console.log(`   ✅ ${p.sku || p} fits (${width}×${length || depth}cm)`);
        } else {
            console.log(`   ❌ ${p.sku || p} too large (${width}×${length || depth}cm)`);
        }
        
        return fits;
    });
    
    console.log(`📐 ${fitting.length} of ${products.length} products fit the space`);
    return fitting;
}


// ============================================
// SERVER-SIDE PRODUCT CARD RENDERING
// ============================================

async function renderProductCard(sku, options = {}) {
    const { showBundleHint = false, personalisation = '' } = options;
    
    const productData = productIndex.bySku[sku];
    if (!productData) {
        console.log(`⚠️ No product data for SKU: ${sku}`);
        return null;
    }
    
    // Get live Shopify data
    const shopifyData = await getCachedShopifyData(sku);
    
    // Determine price - prefer Shopify, fallback to local
    const price = shopifyData?.price || 
                  parseFloat(productData.product_identity?.price_gbp) || 0;
    
  // Determine stock - check regular stock AND pre-order status
    const stock = shopifyData?.stock ?? getProductStock(sku);
    const stockStatus = getStockStatus(sku);
    
    // Double-check stock - BUT allow pre-order items through
    if (stock <= 0 && stockStatus.status !== 'pre_order') {
        console.log(`⚠️ ${sku} out of stock at render time (not pre-order)`);
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
    // stockStatus already defined above
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
        card += `✨ *${personalisation}*\n\n`;
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
    
    card += `\n**Price:** £${price.toFixed(2)}\n`;
    card += `**Stock:** ${stockMessage}\n\n`;
    card += `<a href="${productUrl}" target="_blank" style="display:inline-block; padding:10px 20px; background:#2E6041; color:white; text-decoration:none; border-radius:5px;">View Product →</a>\n`;
    
    if (showBundleHint && productData.related_products?.matching_cover_sku) {
        card += `\n🎁 *Matching cover available - ask about our 20% bundle discount!*\n`;
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
    if (ctx.spaceSize) contextParts.push(`Space: ${ctx.spaceSize}`);
    if (ctx.budget) contextParts.push(`Budget: ${ctx.budget}`);
    
    const contextSummary = contextParts.length > 0 
        ? contextParts.join(' | ') 
        : "New customer - no preferences established yet";
    
    // Track commercial state
    const commercial = sessionState.commercial || {};
    const commercialState = [];
    if (commercial.productsShown?.length > 0) {
        commercialState.push(`Products shown: ${commercial.productsShown.length} (${commercial.productsShown.join(', ')})`);
    }
    if (commercial.sentiment === 'price_concerned') {
        commercialState.push("⚠️ Customer is price-sensitive - emphasise VALUE not price");
    }
    if (commercial.bundleDeclined) {
        commercialState.push("⚠️ Bundle declined - don't offer bundle again");
    }
    if (commercial.bundleInterestShown) {
        commercialState.push("✅ Customer showed bundle interest - push to close bundle deal");
    }

    // Build bundle context for shown products
    let bundleContext = '';
    if (commercial.productsShown?.length > 0) {
        const bundleInfo = [];
        for (const sku of commercial.productsShown) {
            try {
                const bundles = getBundleForProduct(sku);
                if (bundles.length > 0) {
                    const bundle = bundles[0];
                    let bundleTotal = 0;
                    const parts = [];
                    for (const item of bundle.products) {
                        const prod = productIndex.bySku[item.product_sku];
                        if (prod) {
                            const itemPrice = parseFloat(prod.product_identity?.price_gbp) || 0;
                            bundleTotal += itemPrice * item.product_qty;
                            parts.push(prod.product_identity?.product_name || item.product_sku);
                        }
                    }
                    const discount = bundleTotal * (COMMERCE_RULES.bundle.discountPercent / 100);
                    bundleInfo.push(`${bundle.name}: ${parts.join(' + ')} = £${bundleTotal.toFixed(0)} → £${(bundleTotal - discount).toFixed(0)} with ${COMMERCE_RULES.bundle.discountPercent}% off (save £${discount.toFixed(0)})`);
                }
            } catch(e) {}
        }
        if (bundleInfo.length > 0) {
            bundleContext = `\n\nAVAILABLE BUNDLES FOR SHOWN PRODUCTS:\n${bundleInfo.join('\n')}\nProactively mention bundle savings after showing furniture. Frame as: "Great news - there's a bundle deal available..."`;
        }
    }
    
    return `You are Gwen, a warm and knowledgeable sales assistant for MINT Outdoor (www.mint-outdoor.com). You have 25 years of outdoor furniture expertise. You help customers find their perfect garden setup and guide them to purchase.

===========================================================
CURRENT CUSTOMER CONTEXT
===========================================================
${contextSummary}
${commercialState.length > 0 ? '\nCommercial notes: ' + commercialState.join(' | ') : ''}${bundleContext}
===========================================================

YOUR SALES APPROACH - PRODUCT FIRST:
Show products within 2 messages. Do NOT interview the customer with lots of questions.
1. If they name a product → Show it IMMEDIATELY
2. If they give type + size OR material → Show best matches right away
3. If vague ("garden furniture") → Ask ONE qualifying question max, then show products
4. NEVER ask more than 2 questions before showing something

CRITICAL - PRODUCT NAMING:
ALWAYS use the official product name from the product data, NEVER repeat customer typos or misspellings.
Example: Customer says "Barcelona vision set" → You say "Barcelona Lounge Set" (the correct name).
Example: Customer says "Stokholm chais" → You say "Stockholm Chaise Lounge Set".
If you cannot identify which product the customer means, ask for clarification using the correct product names from our range.

CRITICAL - EXISTING ORDERS & DELIVERY:
You CAN help an existing customer with the delivery timing / status of their OWN order — but ONLY using verified order data the system provides you. To look anything up you must have BOTH their order number AND their delivery postcode; politely ask for whichever is missing. NEVER invent, guess, or estimate a delivery date: if the system has not given you a verified date for this order, tell the customer you don't have a confirmed date to hand and ask them to email help@mint-outdoor.com — in this same reply. Never say you'll check or get back to them.
For DAMAGE or missing/faulty parts, point the customer to our care team. For REFUNDS, RETURNS, or CANCELLATIONS, do NOT process these yourself — tell the customer to email help@mint-outdoor.com with their order number and the team will action it. Never invent a refund or returns process beyond this.

CRITICAL - NO STALLING, NO BACKGROUND WORK:
You have NO background process and CANNOT go away and come back. Never tell the customer to wait, that you're "checking", "verifying in the background", "pulling up their order", or that you'll "get back to them". Every reply must be complete in itself: either you have the answer and you give it now, or you don't and you either ask for the specific missing detail or hand off — in THIS reply. Never promise a follow-up you cannot send.

GOLDEN RULE: A customer looking at a product card is 10x more likely to buy than one answering questions.

===========================================================
CORE RULES
===========================================================
1. REMEMBER what customer told you - NEVER re-ask
2. ANSWER direct questions FIRST, then suggest next step
3. When showing products, output SKUs only - server renders cards with images and prices
4. Be warm, confident, and enthusiastic - you LOVE outdoor furniture
5. NEVER write URLs or links - the server adds all links automatically
6. NEVER invent product specs - only use data from search results
7. Frame everything positively: "great choice" not "unfortunately"
8. When a customer likes something → help them BUY, don't show more options

===========================================================
FUZZY QUERY MATCHING - HOW TO INTERPRET CUSTOMER REQUESTS
===========================================================
Customers rarely use exact product names. Here is how to decode their requests:

SEATING REQUESTS - Map to seat counts:
"for 2" / "couple" / "small" / "two of us" / "me and partner" / "just us" → seatCount: 2-4
"for 4" / "family" / "medium" / "small family" / "family of 4" / "few friends" → seatCount: 4-6
"for 6" / "entertaining" / "large" / "family of 6" / "dinner party" / "get-togethers" → seatCount: 6-8
"for 8" / "for 10" / "big group" / "lots of guests" / "big family" / "party" / "BBQ" → seatCount: 8+
"corner" / "L-shaped" / "wrap around" / "sectional" / "modular" → furnitureType: corner

MATERIAL REQUESTS:
"wicker" / "rattan" / "woven" / "weave" / "wicker effect" → material: rattan
"metal" / "aluminium" / "modern" / "sleek" / "contemporary" → material: aluminium
"wood" / "teak" / "natural" / "timber" / "wooden" / "hardwood" → material: teak

TYPE REQUESTS:
"dining" / "eating" / "table and chairs" / "outdoor dining" / "dinner" / "meals outside" → furnitureType: dining
"lounge" / "sofa" / "relax" / "chill" / "couch" / "settee" / "outdoor sofa" / "garden sofa" → furnitureType: lounge
"sunbed" / "lounger" / "sunbathing" / "sun lounger" / "daybed" / "recline" / "tanning" → furnitureType: lounger
"L-shape" / "corner sofa" / "wrap around" / "sectional" / "L shaped" → furnitureType: corner

ACTIVITY-BASED REQUESTS (map the customer's intended USE to furniture type):
"eating outside" / "alfresco" / "BBQ area" / "outdoor meals" / "Sunday lunch" → dining
"relaxing" / "reading" / "drinks" / "unwinding" / "Netflix outside" / "evening drinks" → lounge
"sunbathing" / "tanning" / "pool area" / "sunning" / "laying out" → lounger
"entertaining" / "hosting" / "party" / "guests coming" / "summer gathering" → large dining OR corner (8+ seats)
"cosy corner" / "nook" / "reading spot" / "quiet corner" → small lounge (2-4 seats)
"outdoor living room" / "garden room" / "chill zone" / "outdoor room" → corner OR large lounge

SPACE-BASED REQUESTS:
"small balcony" / "tiny patio" / "courtyard" / "compact space" → 2-4 seats, compact dining or bistro
"medium garden" / "decking area" / "patio" / "terrace" → 4-6 seats
"large garden" / "big patio" / "loads of space" / "big terrace" → 6-10 seats

COMBINED EXAMPLES:
"Barcelona 9 seater" → productFamily: barcelona, seatCount: 9
"large corner rattan" → furnitureType: corner, material: rattan, seatCount: 8
"small teak dining" → furnitureType: dining, material: teak, seatCount: 4
"something for a balcony" → furnitureType: lounge OR dining, seatCount: 2
"need somewhere for Sunday lunches with the family" → furnitureType: dining, seatCount: 6
"want to chill with drinks in the evening" → furnitureType: lounge, seatCount: 4
"hosting a BBQ for 10 people next month" → furnitureType: dining OR corner, seatCount: 10
"nice area for reading and coffee" → furnitureType: lounge, seatCount: 2

WHEN SIZE IS AMBIGUOUS:
If customer says "I have a small patio" → recommend 4-seater AND offer: "How many people would you typically seat?"
If customer gives measurements → use get_product_dimensions to compare

===========================================================
UPSELLING & CROSS-SELLING - REVENUE CRITICAL
===========================================================
After EVERY furniture recommendation, you MUST mention the bundle. This is not optional.

THE BUNDLE-FIRST APPROACH (use this exact flow):

STEP 1 - ANCHOR THE BUNDLE (immediately with first product):
"Most of our customers this month have chosen to add the matching protective cover. It extends the life of your furniture by 3-5 years and keeps it looking pristine. Together as a bundle you save £[XX] - shall I show you the bundle price?"

STEP 2 - VALUE STACK (if they ask about the bundle or show any interest):
"Here is the breakdown:
- [Product Name]: £[price]
- [Matching Cover]: £[price]
- Bought separately: £[total]
- Bundle price: £[discounted total] - you save £[amount]

That works out at roughly £[cover price divided by 5] per year to keep your furniture protected. Most replacement cushions alone cost £150+, so the cover more than pays for itself."

STEP 3 - ASSUME THE SALE (if they haven't declined):
"Shall I add the bundle to help you get the best value? Just click View Product above."

VALUE FRAMING TECHNIQUES:
- Cost per year: "£[cover price] over 5 years = just £[X] per year to protect your investment"
- Replacement cost: "Replacing weather-damaged cushions costs £150+. The cover prevents this."
- Social proof: "9 out of 10 customers this month chose the bundle - it really is a no-brainer"
- Scarcity: "The bundle discount applies when you add both to basket right now"

IF CUSTOMER DECLINES THE BUNDLE:
- Accept gracefully: "No problem at all! The furniture is brilliant on its own."
- Plant a seed: "The cover is always available separately if you change your mind later."
- Do NOT mention the bundle again in this session.

CROSS-SELL HIERARCHY (after bundle, if appropriate):
1. Cushion storage box (if applicable to the product family)
2. Assembly service (£99.95 - "Our team builds it in your garden, you just enjoy it")
3. 2-person delivery upgrade (for larger sets)

===========================================================
MATERIAL & WARRANTY REASSURANCE
===========================================================
When customers ask about quality, durability, or weather resistance, be CONFIDENT and specific:

RATTAN:
- "Our rattan is PE woven - not natural rattan that rots. It is UV-tested to 2000 hours (equivalent to 4+ British summers)"
- "2-year structural and colour warranty, but honestly these sets last 10-15 years with basic care"
- "Just wipe with a damp cloth. Cover it in harsh winters and it will look great for years"

ALUMINIUM:
- "Powder-coated aluminium - completely rust-proof and virtually indestructible"
- "10-year corrosion warranty, but aluminium lasts 20+ years"
- "Zero maintenance needed. A quick wipe with soapy water is all it ever needs"

TEAK:
- "Grade-A plantation teak from sustainable sources - the gold standard of outdoor wood"
- "5-year structural warranty. Teak naturally weathers to a beautiful silver-grey, or oil it annually to keep the golden colour"
- "Teak naturally contains oils that resist rot, insects, and moisture"

ALL MATERIALS:
- "Everything is independently tested to European safety standards (EN-581)"
- "Weight tested to 110kg per seat"
- "25,000-cycle durability testing - simulating years of daily use"

===========================================================
OBJECTION & CONCERN PATTERNS - PROACTIVE REASSURANCE
===========================================================
When you detect ANY of these patterns, deploy reassurance BEFORE they ask:

DURABILITY CONCERNS ("will it last", "how long", "wear and tear", "flimsy", "sturdy", "robust"):
→ Lead with testing: "All our furniture is independently tested to EN-581 European safety standards"
→ Give specifics: "25,000 sit-down cycles in laboratory testing - simulating years of daily use"
→ Social proof: "We have customers still using sets they bought 8+ years ago"

WEATHER CONCERNS ("rain", "winter", "UK weather", "leave out", "British weather", "snow", "frost"):
→ For rattan: "Our PE rattan is UV-tested to 2000 hours - equivalent to 4+ British summers"
→ For aluminium: "Completely rust-proof. Rain, snow, sun - aluminium handles it all"
→ For teak: "Teak naturally contains oils that repel water and insects"
→ Always suggest cover: "For ultimate longevity, a protective cover during harsh winter extends the life by 3-5 years"

VALUE/PRICE CONCERNS ("expensive", "worth it", "cheaper elsewhere", "lot of money", "pricey"):
→ NEVER apologise for price. Reframe as investment:
→ "At £[X], that works out at £[X divided by 10] per year over a 10-year lifespan"
→ "Compared to replacing cheap furniture every 2-3 years, this actually saves money long-term"
→ "The quality difference is night and day - our materials, testing, and warranty back that up"
→ If genuinely budget-constrained, suggest smaller sets or more affordable ranges

COMPARISON SHOPPING ("seen similar on Amazon", "IKEA have cheaper", "found one on eBay", "Argos"):
→ NEVER badmouth competitors. Focus on what makes us different:
→ "Our furniture comes with full EN-581 certification, UK-based warranty support, and dedicated customer service"
→ "We stand behind every product with a structural warranty and a UK support team"

ASSEMBLY CONCERNS ("hard to build", "assembly", "put together", "DIY", "complicated"):
→ "Most of our sets are designed for straightforward assembly - typically 30-60 minutes"
→ "We also offer a professional assembly service for £99.95 - our team does everything in your garden"
→ Always offer assembly as an upsell for larger sets

===========================================================
WHEN CUSTOMER HAS CHOSEN - CLOSE THE SALE
===========================================================
BUYING SIGNALS (when you detect ANY of these, STOP showing products and HELP THEM BUY):

STRONG SIGNALS (immediate close):
- "I like it" / "perfect" / "that's the one" / "love it" / "brilliant"
- "How do I order?" / "How do I buy?" / "Add to basket"
- "What's the delivery?" / "How long to arrive?" (they are planning the purchase)
- "Can I pay in installments?" (they are working out how to afford it)
- "Go with that one" / "That'll do" / "Sorted"

MEDIUM SIGNALS (confirm choice, then close):
- "Looks nice" / "That's really nice" / "Interesting"
- Asking about warranty or returns (they are assessing risk before buying)
- Asking about assembly (they are planning the setup)

CLOSING RESPONSE FORMULA:
1. VALIDATE their choice: "Brilliant choice! The [product name] is one of our best sellers."
2. ANSWER any question they asked (delivery, warranty, etc.)
3. BUNDLE mention (if not yet offered): "And great news - there is a bundle deal available..."
4. CLEAR CTA: "Just click the View Product button above to add it to your basket."
5. REASSURE: "You will get free delivery and our full warranty."

CRITICAL: Once customer has chosen, do NOT:
- Show them more products
- Ask "would you like to see other options?"
- Suggest alternatives unless they specifically ask
- Re-qualify them on size/material/budget

===========================================================
CUSTOMER CORRECTION DETECTION - CRITICAL RULE
===========================================================
When a customer says ANY of these, it means YOUR PREVIOUS ANSWER WAS WRONG OR INCOMPLETE:
- "I asked for..." / "I said..." / "that's not what I asked"
- "no I meant..." / "no, the..." / "not that, I want..."
- "you didn't answer my question" / "that's not what I need"
- "I already told you..." / "as I said..."
- "I need the [X] not the [Y]"

When you detect a correction:
1. ACKNOWLEDGE: "Apologies, let me find that specific information for you."
2. DO NOT repeat your previous response. The customer is telling you it was wrong.
3. IDENTIFY what they actually want — re-read their message carefully.
4. If you genuinely DO NOT have the specific information they are asking for:
   → Say: "I don't have the exact [specific thing they asked for] in my records, but I can connect you with our team who can check for you. Could you share your email address?"
   → Do NOT show the same data again in different formatting.
   → Do NOT say "let me know if you'd like me to confirm" — they ALREADY asked you to confirm. That is deflection.
5. If you DO have the information, provide ONLY what they asked for — not the full data dump again.

EXAMPLE OF WHAT NOT TO DO:
Customer: "What is the leg height?"
You: [shows full footprint dimensions]
Customer: "I asked for sofa legs"
You: [shows SAME full footprint dimensions again] ← THIS IS WRONG. NEVER DO THIS.

CORRECT RESPONSE:
Customer: "I asked for sofa legs"
You: "Apologies! I don't have the exact leg height measurement for that set in my records. Let me connect you with our team who can check the detailed specs — could you share your email address? They'll get back to you within a few hours."

===========================================================
DIMENSION GAP HANDLING - WHEN DATA IS MISSING
===========================================================
Our product database has overall footprint dimensions (width, depth, length) but may NOT have:
- Seat height (floor to top of cushion)
- Leg height (floor to bottom of seat frame)
- Backrest height
- Armrest height
- Table height
- Individual piece dimensions within a set

WHEN A CUSTOMER ASKS FOR A SPECIFIC MEASUREMENT YOU DO NOT HAVE:
1. Do NOT show the footprint dimensions and pretend they answer the question.
2. Do NOT say "check the product page" if you have already tried that.
3. DO say: "I don't have the exact [measurement they asked for] to hand, but I can help in two ways:"
   → "Check the detailed dimension diagram on the product page: [link]"
   → "Or share your email and our team will confirm the exact measurement for you within a few hours."
4. If they have ALREADY been shown the product page link, skip straight to email escalation.

WHAT YOU CAN ANSWER (from footprint dimensions):
- "How big is the set?" → Show width x depth x length
- "Will it fit in my space?" → Show footprint and offer to compare to their space
- "What are the dimensions?" (general) → Show what you have, note any gaps

WHAT YOU CANNOT ANSWER (requires specific data not in database):
- "How high is the seat?" → DO NOT guess. Escalate.
- "What is the leg height?" → DO NOT show footprint dims. Escalate.
- "How tall is the backrest?" → DO NOT show footprint dims. Escalate.
- "What height is the table?" → If no separate table height data, escalate.

===========================================================
CUSTOMER ROUTING
===========================================================
EXISTING CUSTOMER (mentions: my order, delivery, refund, return, tracking, damaged):
→ Direct to Order Helpdesk (server handles automatically)
→ EXCEPTION: If they want to BUY MORE, help them

FRUSTRATED PROSPECT (no order evidence, just frustrated):
→ Offer to connect with customer service (ask for email)
→ NEVER ask "what furniture?" when someone is frustrated

HUMAN SUPPORT REQUEST:
1. Ask for email address first
2. Use request_human_handoff tool
3. Confirm: "I have passed your details to our team - they will email you within a few hours"

===========================================================
PRODUCT NAME RECOGNITION
===========================================================
"[name] set" / "[name] dining" → Show FURNITURE from that family
"[name] cover" → Show COVER for that family
"[name] cushions" → Show REPLACEMENT CUSHIONS
"[name]" alone → Prioritize furniture, mention covers are available

DIMENSION QUERIES:
"how big" / "what size" / "will it fit" / "measurements" → Use get_product_dimensions tool

===========================================================
DELIVERY & AVAILABILITY QUERIES - CRITICAL
===========================================================
When customer asks about delivery dates, availability, restock, pre-order timing, or "when will X arrive":
→ ALWAYS use the get_delivery_estimate tool to look up real dates
→ NEVER give generic "3-5 days" if the item might be a pre-order
→ If customer says they need it by a specific date, pass that date to the tool
→ If customer asks "will X be back in stock?" — use get_delivery_estimate to check incoming shipments
→ Pre-order items: Tell customer the estimated delivery date and that they can secure their order now

===========================================================
LEFT/RIGHT CONFIGURATION - COMMON QUESTION
===========================================================
When customer asks about "left or right corner", "left hand", "right hand", "configuration":
→ Check the configurable_sides field in product data
→ If configurable_sides = "left,right" → "Great news! This set can be configured as either left-hand or right-hand facing. You simply arrange the modular pieces to suit your space layout during assembly."
→ If configurable_sides = "left" → "This set comes in a left-hand configuration. The modular design means you position the longer section on the left side when facing the sofa."
→ If configurable_sides = "Yes" → "This is a fully modular set — you can configure it however you like!"
→ If configurable_sides is empty/missing → "Let me check that for you — I'll connect you with our team who can confirm the exact configuration options."

IMPORTANT: For BUNDLE products (e.g., Stockholm Bundle), the bundle entry may not have configurable_sides data.
In that case, check the underlying FURNITURE product in the same family. For example, if asked about the Stockholm Corner Bundle, check the Stockholm corner set or Stockholm chaise for configuration data.
Corner sofa sets are typically configurable as left or right — if you cannot find the data, say: "Our corner sets are designed to be configurable as either left or right hand facing — you arrange the pieces during assembly to suit your space."

===========================================================
PHONE NUMBER / CALLBACK REQUESTS
===========================================================
We do NOT have a direct customer service phone line. When customer asks for a phone number:
→ Never say "we don't have a phone number" bluntly
→ Instead say: "Rather than a phone line, I can arrange a personal callback from our team! I just need your name, phone number, email and a convenient time window."
→ The system will collect these details and escalate automatically

===========================================================
BUNDLE PRODUCT INTELLIGENCE
===========================================================
Bundle products combine furniture + accessories at a discounted price.
When showing a bundle, present it as great value:
→ Explain what's included (the furniture set + the cover/accessories)
→ Highlight the savings vs buying separately
→ Answer questions about the FURNITURE within the bundle using the furniture product's data
→ If a bundle entry has empty specs, look at the main furniture product in the same family for details

===========================================================
OUTPUT FORMAT - ALWAYS VALID JSON
===========================================================

For conversation (no products):
{
    "intent": "greeting" | "clarification" | "question_answer",
    "response_text": "Your friendly response"
}

For showing products:
{
    "intent": "product_recommendation",
    "intro_copy": "Brief intro (1 sentence max)",
    "selected_skus": ["SKU-1", "SKU-2"],
    "personalisation": "Why these suit the customer",
    "closing_copy": "Engaging question or next step prompt"
}

For dimensions:
{
    "intent": "dimension_query",
    "product_sku": "SKU-HERE",
    "include_box_dimensions": false,
    "response_text": "Optional intro before dimension card"
}

===========================================================
AVAILABLE PRODUCT SKUs (ONLY use these):
${sessionState.availableSkus?.length > 0 
    ? sessionState.availableSkus.join(', ') 
    : 'Call search_products first to find products'}
===========================================================

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
    },
    {
        type: "function",
        function: {
            name: "get_delivery_estimate",
            description: "Get estimated delivery date for a product. Use when customer asks about delivery times, shipping dates, when something will arrive, availability dates, pre-order delivery, restock dates, or whether something will be back in stock. Also use when customer needs something by a specific date.",
            parameters: {
                type: "object",
                properties: {
                    productName: {
                        type: "string",
                        description: "Name or family of the product to check delivery for"
                    },
                    productSku: {
                        type: "string",
                        description: "SKU of the product if known"
                    },
                    requiredByDate: {
                        type: "string",
                        description: "If customer needs it by a specific date, include that date here (e.g., '8 April 2026')"
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_order_delivery_status",
            description: "Look up the REAL, current delivery date for an EXISTING customer's order. Use ONLY for an existing order the customer is asking about (where is my order, when will it arrive, delivery date/status). You MUST have collected BOTH the order number AND the delivery postcode before calling — if either is missing, ask the customer for it first in your reply. This verifies identity (order number + postcode) and returns a verified delivery date or instructions. NEVER fabricate or guess a delivery date yourself; only state what this tool returns.",
            parameters: {
                type: "object",
                properties: {
                    orderNumber: {
                        type: "string",
                        description: "The customer's order number (digits)."
                    },
                    postcode: {
                        type: "string",
                        description: "The customer's delivery postcode, used to verify their identity against the order."
                    }
                },
                required: ["orderNumber", "postcode"]
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
    const bundleInterestWords = ['bundle', 'discount', 'together', 'package', 'deal', 'cover', 'protect', 'save', 
                                  'offer', 'offers', 'deals', 'combo', 'both', 'money off', 'special price', 'savings'];
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
            pitch: `Save time with our professional assembly service - just £${COMMERCE_RULES.crossSell.assemblyPrice}!`
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
                  bundleProductNames.map(n => `✔ ${n}`).join('\n') + `\n\n` +
                  `**Bundle Price: £${finalPrice.toFixed(2)}** ~~£${bundleTotal.toFixed(2)}~~\n` +
                  `*You save: £${discount.toFixed(2)}*\n\n` +
                  `**To order:**\n` +
                  `1️⃣ Click the link below to view the main product\n` +
                  `2️⃣ Add it to your basket\n` +
                  `3️⃣ The matching accessories will be suggested at checkout\n` +
                  `4️⃣ Your ${COMMERCE_RULES.bundle.discountPercent}% bundle discount applies automatically!\n\n` +
                  `<a href="${productUrl}" target="_blank" style="display:inline-block; padding:12px 24px; background:#2E6041; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">ORDER NOW → £${finalPrice.toFixed(2)}</a>\n\n` +
                  `Or if you'd like me to email you this quote to review later, just let me know your email address and I'll send it with the discount locked in for 48 hours! 📧`,
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
                  `**Price: £${price.toFixed(2)}**\n` +
                  `✅ In stock with 3-5 day delivery\n` +
                  `✅ 1-year warranty included\n\n` +
                  `**To order:**\n` +
                  `Simply click the button below to add it to your basket and checkout:\n\n` +
                  `<a href="${productUrl}" target="_blank" style="display:inline-block; padding:12px 24px; background:#2E6041; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">ORDER NOW → £${price.toFixed(2)}</a>\n\n` +
                  `Would you also like a protective cover? It extends the furniture's life by 3-5 years and you'll save ${COMMERCE_RULES.bundle.discountPercent}% when bought together! 🎁`,
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
              `📋 Product specifications and dimensions\n` +
              `💰 Your personalised quote with any bundle discounts\n` +
              `🔒 Discount locked in for 48 hours\n\n` +
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
            text: `🎁 *Great news! This comes with a matching protective cover bundle - save ${COMMERCE_RULES.bundle.discountPercent}% when you buy together. Would you like details?*`
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
                productDetails.push(`- ${prod.product_identity?.product_name}: £${price.toFixed(2)}`);
            }
        }
        
        const discount = totalOriginal * (COMMERCE_RULES.bundle.discountPercent / 100);
        const bundlePrice = totalOriginal - discount;
        
        return {
            type: 'detailed',
            text: `🎁 **${bundle.name} Bundle Deal**\n\n${productDetails.join('\n')}\n\n~~Original: £${totalOriginal.toFixed(2)}~~\n**Bundle Price: £${bundlePrice.toFixed(2)}**\n*You save: £${discount.toFixed(2)} (${COMMERCE_RULES.bundle.discountPercent}% off)*\n\nWant me to add this bundle to help you complete your purchase?`
        };
    }
}

// ============================================
// VALIDATE AI OUTPUT
// ============================================

function validateAIOutput(aiOutput, whitelist, sessionId) {
    if (!aiOutput || !aiOutput.intent) {
        console.log(`⚠️ [${sessionId}] Missing aiOutput or intent`);
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
                console.log(`🛡️ [${sessionId}] BLOCKED: "${sku}" not in whitelist`);
            }
        }
        
        aiOutput.selected_skus = validSkus;
        
        if (invalidSkus.length > 0) {
            console.log(`🛡️ Whitelist was: [${whitelist.join(', ')}]`);
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
                console.log(`🎁 Bundle offer added (${bundleEligibility.offerType}) - positive signal: ${hasPositiveSignal}`);
            }
        }
        
        // Cross-sell: Only if no bundle offered AND customer has shown interest
        if (!shouldOfferBundle && hasPositiveSignal) {
            const crossSells = getCrossSellSuggestions(mainProductSku, session);
            
            if (crossSells.length > 0 && session.commercial.crossSellsShown.length < 2) {
                const suggestion = crossSells[0];
                parts.push('');
                parts.push(`💡 *${suggestion.pitch}*`);
                session.commercial.crossSellsShown.push(suggestion.sku);
                console.log(`💡 Cross-sell suggested: ${suggestion.type}`);
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
        let { message, sessionId } = req.body;
        
        if (!message || !sessionId) {
            return res.status(400).json({ 
                response: 'Please provide a message and session ID.'
            });
        }
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📩 [${sessionId}] "${message}"`);
        
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
        
        // ============================================
        // v16.2: TYPO CORRECTION ENGINE
        // Corrects common misspellings BEFORE any processing
        // This is a FURNITURE website — interpret everything in furniture context
        // ============================================
        const typoMap = {
            // Common keyboard typos for furniture terms
            'sodas': 'sofas', 'soads': 'sofas', 'sofar': 'sofas', 'sofer': 'sofas',
            'sfoas': 'sofas', 'sophas': 'sofas', 'sopha': 'sofa',
            'charis': 'chairs', 'chiar': 'chair', 'cahir': 'chair', 'chaire': 'chair',
            'tabel': 'table', 'talbe': 'table', 'tbale': 'table',
            'dinning': 'dining', 'dinig': 'dining', 'dning': 'dining',
            'louge': 'lounge', 'louneg': 'lounge', 'lougne': 'lounge',
            'ratton': 'rattan', 'raten': 'rattan', 'rattn': 'rattan', 'ratan': 'rattan',
            'alumimium': 'aluminium', 'aluminuim': 'aluminium', 'aluninium': 'aluminium',
            'furntiure': 'furniture', 'furnitrue': 'furniture', 'furntiture': 'furniture',
            'cushoins': 'cushions', 'cusions': 'cushions', 'cushons': 'cushions',
            'delievry': 'delivery', 'delivrey': 'delivery', 'dleivery': 'delivery',
            'waranty': 'warranty', 'warrnty': 'warranty', 'warrenty': 'warranty',
            'assebmly': 'assembly', 'asembly': 'assembly', 'assembley': 'assembly',
            'covr': 'cover', 'covre': 'cover', 'cvover': 'cover',
            'seater': 'seater', 'seter': 'seater', 'seaer': 'seater',
            'corener': 'corner', 'conrer': 'corner', 'cornr': 'corner',
            'gadern': 'garden', 'graden': 'garden', 'gardn': 'garden',
            'outoor': 'outdoor', 'outdor': 'outdoor', 'outdoro': 'outdoor',
            'barbeque': 'barbecue', 'barcecue': 'barbecue',
            // Product name typos (from real conversations)
            'stockholme': 'stockholm', 'stokholm': 'stockholm', 'stockholn': 'stockholm',
            'chesterson': 'chesterton', 'chesteron': 'chesterton', 'chestertone': 'chesterton',
            'santornini': 'santorini', 'santorinni': 'santorini',
            'mareblla': 'marbella', 'marbela': 'marbella', 'marbellla': 'marbella',
            'barcelon': 'barcelona', 'bareclona': 'barcelona',
            'plama': 'palma', 'palna': 'palma', 'pamla': 'palma', 'parlma': 'palma',
            'palmer': 'palma',
            'sorento': 'sorrento', 'sorenro': 'sorrento', 'sorrenot': 'sorrento',
            // Context-aware: on a furniture site, these ALWAYS mean furniture
            'soda': 'sofa', 'couch': 'sofa', 'settee': 'sofa', 'suit': 'set',
            'suits': 'sets', 'sweet': 'set', 'sweets': 'sets'
        };
        
        let correctedMessage = message;
        const words = message.toLowerCase().split(/\s+/);
        let typosFixed = [];
        for (const word of words) {
            const cleanWord = word.replace(/[^a-z]/g, '');
            if (typoMap[cleanWord]) {
                const regex = new RegExp(`\\b${cleanWord}\\b`, 'gi');
                correctedMessage = correctedMessage.replace(regex, typoMap[cleanWord]);
                typosFixed.push(`${cleanWord}→${typoMap[cleanWord]}`);
            }
        }
        if (typosFixed.length > 0) {
            console.log(`✏️ Typo corrections: ${typosFixed.join(', ')}`);
            console.log(`✏️ Original: "${message}"`);
            console.log(`✏️ Corrected: "${correctedMessage}"`);
            // Replace message so ALL downstream code uses the corrected version
            message = correctedMessage;
        }
        
        const msgLower = correctedMessage.toLowerCase();
        
        // ============================================
        // v16.1: INTELLIGENT INTENT-TO-CRITERIA MAPPING
        // Maps natural language activities to furniture search criteria
        // This runs BEFORE the AI call to pre-seed session context
        // ============================================
        const intentMap = [
            { patterns: ["sunday lunch", "alfresco dining", "eat outside", "eating outside",
                "outdoor meal", "meals outside", "bbq area", "barbecue", "dinner party",
                "kids to eat", "family meals", "food outside", "outdoor kitchen",
                "table for", "sit and eat", "christmas dinner", "lunch outside"],
                type: "dining", defaultSeats: 6 },
            { patterns: ["drinks", "cocktails", "nibbles", "wine", "relax", "unwind",
                "chill", "read outside", "lazy afternoon", "evening drinks",
                "netflix", "outdoor living", "coffee outside", "morning coffee",
                "sit and chat", "glass of wine", "quiet evening"],
                type: "lounge", defaultSeats: 4 },
            { patterns: ["entertaining", "hosting", "guests coming", "party", "gathering",
                "get-together", "family gathering", "christmas", "summer party",
                "lots of people", "big group", "bbq party", "garden party"],
                type: null, defaultSeats: 8 },
            { patterns: ["sunbathe", "tanning", "pool", "sunning", "lay out",
                "sun worship", "catch some sun", "sun trap"],
                type: "lounger", defaultSeats: null },
        ];
        
        for (const intent of intentMap) {
            const matched = intent.patterns.some(p => msgLower.includes(p));
            if (matched) {
                if (intent.type && !session.context.furnitureType) {
                    session.context.furnitureType = intent.type;
                    console.log(`🧠 Intent mapped: "${intent.type}" from activity language`);
                }
                if (intent.defaultSeats && !session.context.seatCount) {
                    session.context.seatCount = intent.defaultSeats;
                    console.log(`🧠 Intent mapped: ${intent.defaultSeats} seats from activity language`);
                }
                break;
            }
        }
        
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
        
        // Phase 0.0: damage/claim and refund/return/cancel are distinct deterministic
        // intakes (care form / help@), NOT order-status. Order-status falls through.
        const damageClaimPatterns = [
            'arrived damaged', 'arrived broken', 'damaged on arrival', 'arrived faulty', 'faulty',
            'wrong item', 'wrong item sent', 'sent wrong', 'received wrong',
            'missing part', 'missing parts', 'parts missing',
            'missing from order', 'missing from my', 'missing from the'
        ];
        const refundReturnCancelPatterns = [
            'refund', 'send back', 'sending back', 'send it back', 'money back',
            'return my', 'return it', 'want a refund', 'get a refund',
            'cancel my order', 'cancel order', 'cancel my', 'cancel it',
            'want to cancel', 'like to cancel'
        ];

        const hasOrderEvidence = orderEvidencePatterns.some(p => msgLower.includes(p));
        const hasDamageClaim = damageClaimPatterns.some(p => msgLower.includes(p));
        const hasRefundReturnCancel = refundReturnCancelPatterns.some(p => msgLower.includes(p));
        const hasFrustration = frustrationPatterns.some(p => msgLower.includes(p));
        const isNotACustomer = notACustomerPatterns.some(p => msgLower.includes(p));
        const wantsToBuyMore = msgLower.includes('buy more') || msgLower.includes('order more') || 
                               msgLower.includes('another') || msgLower.includes('additional order') ||
                               msgLower.includes('new order') || msgLower.includes('want to buy');
        
        // ROUTE A (Phase 0.0): DAMAGE / CLAIM only → deterministic deflection to the care
        // form. Order-status / delivery queries are NO LONGER caught here — they fall
        // through to the assistant (Phase 0.1 adds verified order-status lookup).
        if (hasDamageClaim && !isNotACustomer && !wantsToBuyMore) {
            console.log(`🛠️ DAMAGE/CLAIM DETECTED → care form: "${message}"`);

            const careFormUrl = 'https://care.mint-outdoor.com/';
            const damageResponse = `I'm really sorry to hear something's arrived damaged or isn't right. The quickest way to get this sorted is our dedicated care team, who handle replacements and any missing or damaged parts.\n\n**Please tell us what's happened here:**\n<a href="${careFormUrl}" target="_blank" style="display:inline-block; padding:12px 24px; background:#2E6041; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">Get this sorted →</a>\n\nYou'll just need your order number to hand, and they'll arrange a replacement or fix for you.\n\nIf there's anything else I can help with in the meantime, I'm right here!`;

            session.conversationHistory.push({ role: 'user', content: message });
            session.conversationHistory.push({ role: 'assistant', content: damageResponse });

            await logConversationMessage(sessionId, 'user', message, { sentiment: 'damage_claim' });
            await logConversationMessage(sessionId, 'assistant', damageResponse, { intent: 'damage_care_form_redirect' });

            return res.json({ response: damageResponse, sessionId });
        }

        // ROUTE A2 (Phase 0.0): REFUND / RETURN / CANCEL → concrete interim destination
        // (email help@). Only fires on explicit refund/return/cancel language. Phase 1
        // will formalise the goodwill→escalation flow; this is the interim destination.
        if (hasRefundReturnCancel && !isNotACustomer && !wantsToBuyMore) {
            console.log(`💸 REFUND/RETURN/CANCEL DETECTED → help@: "${message}"`);

            const refundResponse = `I'm sorry you're looking to arrange that. To get a refund, return, or cancellation actioned, please email our team at <a href="mailto:help@mint-outdoor.com">help@mint-outdoor.com</a> with your order number and they'll get it sorted for you as quickly as possible.\n\nIf there's anything else I can help with in the meantime, I'm right here!`;

            session.conversationHistory.push({ role: 'user', content: message });
            session.conversationHistory.push({ role: 'assistant', content: refundResponse });

            await logConversationMessage(sessionId, 'user', message, { sentiment: 'refund_return_cancel' });
            await logConversationMessage(sessionId, 'assistant', refundResponse, { intent: 'refund_help_email_redirect' });

            return res.json({ response: refundResponse, sessionId });
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
            console.log(`🚨 Customer accepted escalation offer - proceeding with email capture`);
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
                
                console.log(`📧 ESCALATION EMAIL SENT (with affirmative): ${session.customerEmail}`);
                
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
                
                console.log(`📧 ESCALATION EMAIL SENT after email capture: ${session.customerEmail}`);
                
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
            console.log(`🔄 Change request detected`);
        }
        
        // ============================================
        // MATERIAL EXTRACTION - All database values + synonyms
        // ============================================
        
        // Rattan (and synonyms)
        if (msgLower.includes('rattan') || msgLower.includes('wicker') || 
            msgLower.includes('poly rattan') || msgLower.includes('pe rattan') ||
            msgLower.includes('synthetic rattan')) {
            session.context.material = 'rattan';
            console.log(`📝 Context: material = rattan`);
        }
        
        // Teak
        if (msgLower.includes('teak')) {
            session.context.material = 'teak';
            console.log(`📝 Context: material = teak`);
        }
        
        // Wood (and synonyms) - check this AFTER teak so teak doesn't get overwritten
        if ((msgLower.includes('wood') || msgLower.includes('wooden') || 
             msgLower.includes('acacia') || msgLower.includes('hardwood')) &&
            !msgLower.includes('teak')) {
            session.context.material = 'wood';
            console.log(`📝 Context: material = wood`);
        }
        
        // Aluminium (and synonyms)
        if (msgLower.includes('aluminium') || msgLower.includes('aluminum') || 
            msgLower.includes('alloy')) {
            session.context.material = 'aluminium';
            console.log(`📝 Context: material = aluminium`);
        }
        
        // Metal (maps to aluminium for search, but also catches steel)
        if (msgLower.includes('metal') || msgLower.includes('steel')) {
            session.context.material = 'aluminium';
            console.log(`📝 Context: material = aluminium (from metal/steel)`);
        }
        
        // Woven
        if (msgLower.includes('woven') && !msgLower.includes('rattan')) {
            session.context.material = 'woven';
            console.log(`📝 Context: material = woven`);
        }
        
        // Clear whitelist if material changed
        if (previousMaterial && session.context.material && previousMaterial !== session.context.material) {
            console.log(`🔄 Material changed: ${previousMaterial} → ${session.context.material} - clearing whitelist`);
            session.currentWhitelist = [];
        }
        
        // ============================================
        // FURNITURE TYPE EXTRACTION - All types + synonyms
        // ============================================
        
        // Dining
        if (msgLower.includes('dining') || msgLower.includes('dinner') || 
            msgLower.includes('eating') || msgLower.includes('table and chair')) {
            session.context.furnitureType = 'dining';
            console.log(`📝 Context: type = dining`);
        }
        
        // Lounge (and synonyms)
        if (msgLower.includes('lounge') || msgLower.includes('lounging') || 
            msgLower.includes('sofa') || msgLower.includes('couch') ||
            msgLower.includes('seating') || msgLower.includes('relax')) {
            session.context.furnitureType = 'lounge';
            console.log(`📝 Context: type = lounge`);
        }
        
        // Corner (and synonyms)
        if (msgLower.includes('corner') || msgLower.includes('l-shape') || 
            msgLower.includes('l shape') || msgLower.includes('l shaped')) {
            session.context.furnitureType = 'corner';
            console.log(`📝 Context: type = corner`);
        }
        
        // Sun lounger (and synonyms)
        if (msgLower.includes('sun lounger') || msgLower.includes('sunlounger') ||
            msgLower.includes('sunbed') || msgLower.includes('sun bed') ||
            msgLower.includes('daybed') || msgLower.includes('day bed') ||
            (msgLower.includes('lounger') && !msgLower.includes('lounge set'))) {
            session.context.furnitureType = 'lounger';
            console.log(`📝 Context: type = lounger`);
        }
        
        // Chaise
        if (msgLower.includes('chaise')) {
            session.context.furnitureType = 'lounge';
            session.context.subType = 'chaise';
            console.log(`📝 Context: type = lounge (chaise)`);
        }
        
        // Bistro (small sets)
        if (msgLower.includes('bistro') || msgLower.includes('cafe') ||
            msgLower.includes('balcony set') || msgLower.includes('2 person')) {
            session.context.furnitureType = 'dining';
            session.context.seatCount = 2;
            console.log(`📝 Context: type = dining (bistro), seats = 2`);
        }
        
        // Modular
        if (msgLower.includes('modular') || msgLower.includes('configurable')) {
            session.context.subType = 'modular';
            console.log(`📝 Context: subType = modular`);
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
            console.log(`🔄 Type changed: ${previousType} → ${session.context.furnitureType} - clearing whitelist`);
            session.currentWhitelist = [];
        }
        
        // ============================================
        // SEAT COUNT EXTRACTION - Numbers + descriptive words
        // ============================================
        
        // Numeric patterns
        const seatMatch = msgLower.match(/(\d+)\s*(?:people|person|seat|seater|guests?)/);
        if (seatMatch) {
            session.context.seatCount = parseInt(seatMatch[1]);
            console.log(`📝 Context: seats = ${session.context.seatCount}`);
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
                console.log(`📝 Context: seats = ${num} (from "${word}")`);
                break;
            }
        }
        
        // Size descriptors
        if (msgLower.includes('small') || msgLower.includes('compact') || 
            msgLower.includes('cosy') || msgLower.includes('cozy') ||
            msgLower.includes('tiny') || msgLower.includes('little')) {
            if (!session.context.seatCount) {
                session.context.sizePreference = 'small';
                console.log(`📝 Context: size preference = small`);
            }
            session.currentWhitelist = [];
        }
        
        if (msgLower.includes('large') || msgLower.includes('big') || 
            msgLower.includes('spacious') || msgLower.includes('family') ||
            msgLower.includes('entertaining') || msgLower.includes('party') ||
            msgLower.includes('guests')) {
            if (!session.context.seatCount) {
                session.context.sizePreference = 'large';
                console.log(`📝 Context: size preference = large`);
            }
            session.currentWhitelist = [];
        }
        
        // Relative size changes
        if (msgLower.includes('smaller') || msgLower.includes('fewer seat')) {
            console.log(`📝 Customer wants smaller - clearing whitelist`);
            session.context.sizePreference = 'smaller';
            session.currentWhitelist = [];
        }
        if (msgLower.includes('bigger') || msgLower.includes('larger') || msgLower.includes('more seat')) {
            console.log(`📝 Customer wants bigger - clearing whitelist`);
            session.context.sizePreference = 'larger';
            session.currentWhitelist = [];
        }
        
        // Clear whitelist if seat count changed
        if (previousSeats && session.context.seatCount && previousSeats !== session.context.seatCount) {
            console.log(`🔄 Seats changed: ${previousSeats} → ${session.context.seatCount} - clearing whitelist`);
            session.currentWhitelist = [];
        }
        
        // ============================================
        // COLOUR EXTRACTION
        // ============================================
        if (msgLower.includes('grey') || msgLower.includes('gray')) {
            session.context.colour = 'grey';
            console.log(`📝 Context: colour = grey`);
        }
        if (msgLower.includes('black')) {
            session.context.colour = 'black';
            console.log(`📝 Context: colour = black`);
        }
        if (msgLower.includes('beige') || msgLower.includes('cream') || msgLower.includes('natural')) {
            session.context.colour = 'beige';
            console.log(`📝 Context: colour = beige`);
        }
        if (msgLower.includes('green')) {
            session.context.colour = 'green';
            console.log(`📝 Context: colour = green`);
        }
        if (msgLower.includes('taupe') || msgLower.includes('brown')) {
            session.context.colour = 'taupe';
            console.log(`📝 Context: colour = taupe`);
        }
        if (msgLower.includes('white')) {
            session.context.colour = 'white';
            console.log(`📝 Context: colour = white`);
        }
        
        // ============================================
        // PRICE SENSITIVITY EXTRACTION
        // ============================================
        const budgetWords = ['cheap', 'budget', 'affordable', 'inexpensive', 'low cost', 'bargain', 'value'];
        const premiumWords = ['premium', 'luxury', 'high-end', 'high end', 'top quality', 'best quality', 'expensive'];
        
        if (budgetWords.some(word => msgLower.includes(word))) {
            session.context.priceRange = 'budget';
            session.commercial.sentiment = 'price_concerned';
            console.log(`📝 Context: price range = budget`);
            session.currentWhitelist = [];
        }
        
        if (premiumWords.some(word => msgLower.includes(word))) {
            session.context.priceRange = 'premium';
            console.log(`📝 Context: price range = premium`);
        }
        
        // Price threshold detection
        const priceMatch = msgLower.match(/(?:under|below|less than|up to|max|maximum)\s*£?\s*(\d+)/);
        if (priceMatch) {
            session.context.maxPrice = parseInt(priceMatch[1]);
            console.log(`📝 Context: max price = £${session.context.maxPrice}`);
            session.currentWhitelist = [];
        }
        
        const minPriceMatch = msgLower.match(/(?:over|above|more than|at least|minimum)\s*£?\s*(\d+)/);
        if (minPriceMatch) {
            session.context.minPrice = parseInt(minPriceMatch[1]);
            console.log(`📝 Context: min price = £${session.context.minPrice}`);
        }
        
        // "too expensive" detection
        if (msgLower.includes('too expensive') || msgLower.includes('too much') || 
            msgLower.includes('too pricey') || msgLower.includes('can\'t afford')) {
            session.commercial.sentiment = 'price_concerned';
            console.log(`💰 Price concern detected - clearing whitelist`);
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
            console.log(`📐 Dimension query detected`);
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
            console.log(`📐 Customer space detected: ${session.context.customerSpace.width}cm × ${session.context.customerSpace.length}cm`);
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
            console.log(`📦 Box dimension query detected`);
        }
        
        // ============================================
        // GENERIC CHANGE REQUEST - Clear whitelist
        // ============================================
        if (isChangeRequest && session.currentWhitelist.length > 0) {
            console.log(`🔄 Change request with existing whitelist - clearing for fresh search`);
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
            console.log(`💰 Sentiment: Price concerned`);
        } else if (sentiment.positive) {
            session.commercial.sentiment = 'positive';
            session.commercial.positiveSignalReceived = true;
            console.log(`😊 Sentiment: Positive signal received`);
        }
        
        if (sentiment.strongPositive) {
            session.commercial.strongPositiveReceived = true;
            console.log(`🎯 Sentiment: Strong positive - customer has chosen!`);
        }
        
        if (sentiment.bundleInterest) {
            session.commercial.bundleInterestShown = true;
            console.log(`🎁 Bundle interest detected`);
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
            console.log(`🚨 LOST_SALE: Customer leaving - "${message.substring(0, 80)}..."`);
            session.commercial.sentiment = 'leaving';
            session.commercial.lostSaleReason = message;
            session.commercial.lostSaleTimestamp = new Date().toISOString();
        }
        
        if (sentiment.decline) {
            if (session.commercial.lastOfferType === 'bundle') {
                session.commercial.bundleDeclined = true;
                console.log(`❌ Bundle offer declined`);
            } else if (session.commercial.lastOfferType === 'upsell') {
                session.commercial.upsellDeclined = true;
                console.log(`❌ Upsell declined`);
            }
        }
        
        // ============================================
        // PURCHASE INTENT HANDLING - TRIGGER CLOSING FLOW
        // ============================================
        
        // v16.0: Also trigger closing when customer shows strong positive sentiment
        // or when they express positive sentiment about a specific shown product
        const hasProductsShown = session.commercial.productsShown.length > 0;
        
        // Check if customer is referring to a specific shown product positively
        // e.g. "i like the stockholm chaise", "that's perfect", "the palma looks great"
        let customerChosenProduct = false;
        if (sentiment.positive && hasProductsShown) {
            const shownProducts = session.commercial.productsShown;
            for (const sku of shownProducts) {
                const product = productIndex.bySku[sku];
                if (product) {
                    const family = (product.product_identity?.product_family || '').toLowerCase();
                    const name = (product.product_identity?.product_name || '').toLowerCase();
                    // Check if message references this product by family name or product name
                    if ((family && msgLower.includes(family)) || 
                        (name && name.split(' ').some(word => word.length > 3 && msgLower.includes(word)))) {
                        customerChosenProduct = sku;
                        console.log(`🎯 Customer expressed positive sentiment about shown product: ${sku}`);
                        break;
                    }
                }
            }
            // Also catch generic positive about last shown product: "i like it", "that's the one", "looks perfect"
            const genericPositive = ['i like it', 'i love it', 'that\'s the one', 'that looks', 'looks perfect', 
                                     'looks great', 'looks good', 'that\'s perfect', 'that\'s great', 'perfect for'];
            if (!customerChosenProduct && genericPositive.some(p => msgLower.includes(p))) {
                customerChosenProduct = shownProducts[shownProducts.length - 1];
                console.log(`🎯 Generic positive about last shown product: ${customerChosenProduct}`);
            }
        }
        
        const shouldTriggerClosing = hasProductsShown && (
            sentiment.readyToBuy || 
            sentiment.strongPositive || 
            customerChosenProduct
        );
        
        if (shouldTriggerClosing) {
            const triggerReason = sentiment.readyToBuy ? 'ready_to_buy' : 
                                  sentiment.strongPositive ? 'strong_positive' : 'product_chosen';
            console.log(`🛒 PURCHASE INTENT DETECTED (${triggerReason}) - Triggering closing flow`);
            
            // If customer chose a specific product, make sure it's the "main" product for closing
            if (customerChosenProduct && customerChosenProduct !== session.commercial.productsShown[0]) {
                // Move chosen product to front of shown list so closing flow uses it
                session.commercial.productsShown = [
                    customerChosenProduct, 
                    ...session.commercial.productsShown.filter(s => s !== customerChosenProduct)
                ];
            }
            
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
                    triggerReason: triggerReason,
                    timestamp: new Date().toISOString()
                }
            });
            
            console.log(`📤 Closing flow response sent (trigger: ${triggerReason})`);
            
            // Log both messages to database
            await logConversationMessage(sessionId, 'customer', message, {
                sentiment: session.commercial.sentiment
            });
            await logConversationMessage(sessionId, 'gwen', closingResponse.text, {
                intent: 'checkout_flow',
                productsShown: session.commercial.productsShown.slice(-3),
                sentiment: session.commercial.sentiment,
                triggerReason: triggerReason
            });
            
            return res.json({
                response: closingResponse.text,
                sessionId: sessionId
            });
        }

        // ============================================
        // PRE-AI ESCALATION CHECK - Intercept before AI call
        // ============================================
        const preAiEscalationPatterns = [
            'speak to someone', 'speak to a person', 'speak to a human', 'speak to agent',
            'speak to human', 'speak to person', 'speak to manager', 'speak to representative',
            'talk to someone', 'talk to a person', 'talk to a human', 'talk to agent',
            'talk to human', 'talk to person', 'talk to manager',
            'real person', 'real human', 'human agent', 'live agent',
            'want to speak', 'want to talk', 'i want a person', 'i want a human'
        ];
        
        const wantsHumanPreAI = preAiEscalationPatterns.some(p => msgLower.includes(p));
        
        if (wantsHumanPreAI) {
            console.log(`🚨 PRE-AI: Human escalation detected - "${message}"`);
            
            if (session.customerEmail) {
                const emailResult = await sendEscalationEmail(
                    session.customerEmail,
                    session.customerName || 'Not provided',
                    `Customer requested human support. Message: "${message}"`,
                    session.conversationHistory || [],
                    session.commercial.productsShown || []
                );
                
                const escalationResponse = `I've passed your request to our customer service team. They will email you at ${session.customerEmail} within a few hours (or first thing tomorrow if outside business hours). Is there anything else I can help with in the meantime?`;
                
                session.conversationHistory.push({ role: 'user', content: message });
                session.conversationHistory.push({ role: 'assistant', content: escalationResponse });
                
                await logConversationMessage(sessionId, 'user', message, { sentiment: 'escalation_request' });
                await logConversationMessage(sessionId, 'assistant', escalationResponse, { intent: 'escalation_sent' });
                
                return res.json({ response: escalationResponse, sessionId });
            } else {
                session.pendingEscalation = true;
                session.escalationReason = `Customer requested to speak to a person. Last message: "${message}"`;
                session.escalationOffered = true;
                
                const emailRequestResponse = `Of course! I'll connect you with our customer service team who can help you directly.\n\nSo they can get back to you quickly, could you please share your email address? I'll pass on our full conversation so they have all the context.`;
                
                session.conversationHistory.push({ role: 'user', content: message });
                session.conversationHistory.push({ role: 'assistant', content: emailRequestResponse });
                
                await logConversationMessage(sessionId, 'user', message, { sentiment: 'escalation_request' });
                await logConversationMessage(sessionId, 'assistant', emailRequestResponse, { intent: 'email_capture_for_escalation' });
                
                return res.json({ response: emailRequestResponse, sessionId });
            }
        }
        
        // ============================================
        // PRE-AI PHONE/CALLBACK REQUEST CHECK
        // ============================================
        const phoneRequestPatterns = [
            'phone number', 'phone line', 'telephone number', 'call you', 'can i call',
            'ring you', 'ring me', 'call me', 'call back', 'callback',
            'want to call', 'need to call', 'is there a number', 'have a number',
            'give me a call', 'give me your number', 'your phone number',
            'customer service number', 'helpline', 'hotline'
        ];
        
        const wantsPhoneCall = phoneRequestPatterns.some(p => msgLower.includes(p));
        
        if (wantsPhoneCall) {
            console.log(`📞 PRE-AI: Phone/callback request detected - "${message}"`);
            
            session.pendingCallback = true;
            session.callbackStage = 'collect_details';
            
            const callbackResponse = `We don't currently have a direct phone line, but I can absolutely arrange for one of our team to call you back!\n\nTo set that up, I just need a few details:\n\n1. Your **full name**\n2. Your **phone number**\n3. Your **email address**\n4. A **convenient time** for the callback (e.g., "mornings", "after 2pm", "anytime")\n\nPlease share those and I'll get it arranged for you straight away.`;
            
            session.conversationHistory.push({ role: 'user', content: message });
            session.conversationHistory.push({ role: 'assistant', content: callbackResponse });
            
            await logConversationMessage(sessionId, 'user', message, { intent: 'phone_request' });
            await logConversationMessage(sessionId, 'assistant', callbackResponse, { intent: 'callback_collection' });
            
            return res.json({ response: callbackResponse, sessionId });
        }
        
        // ============================================
        // CALLBACK DETAILS COLLECTION
        // ============================================
        if (session.pendingCallback) {
            // Try to extract callback details from message
            const phoneMatch = message.match(/(?:0|\+44|44)[\s.-]?\d{3,4}[\s.-]?\d{3,4}[\s.-]?\d{0,4}/);
            const emailMatch = message.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
            
            if (phoneMatch) session.callbackPhone = phoneMatch[0];
            if (emailMatch) session.callbackEmail = emailMatch[0];
            
            // Try to detect a name (text before/around the phone/email, or standalone name-like text)
            const nameMatch = message.match(/(?:name is |i'm |i am |my name's )([A-Za-z]+ ?[A-Za-z]*)/i);
            if (nameMatch) session.callbackName = nameMatch[1].trim();
            
            // If no structured name found, look for capitalized words that aren't common words
            if (!session.callbackName) {
                const words = message.split(/[\s,]+/);
                const commonWords = ['my', 'name', 'is', 'the', 'i', 'am', 'please', 'call', 'me', 'back', 'at', 'on', 'phone', 'email', 'number', 'morning', 'afternoon', 'evening', 'anytime', 'after', 'before', 'around', 'between'];
                const possibleName = words.filter(w => 
                    w.length > 1 && 
                    /^[A-Z]/.test(w) && 
                    !commonWords.includes(w.toLowerCase()) &&
                    !w.includes('@') &&
                    !/^\d/.test(w)
                ).join(' ');
                if (possibleName.length > 1) session.callbackName = possibleName;
            }
            
            // Check for time preferences
            const timePatterns = /(?:morning|afternoon|evening|anytime|any time|after \d|before \d|between \d|\d+(?:am|pm|:\d{2}))/i;
            const timeMatch = message.match(timePatterns);
            if (timeMatch) session.callbackTime = timeMatch[0];
            
            // Check if we have enough info to send the escalation
            const hasPhone = !!session.callbackPhone;
            const hasEmail = !!session.callbackEmail;
            const hasName = !!session.callbackName;
            
            if (hasPhone || hasEmail) {
                session.pendingCallback = false;
                
                // Send escalation email with callback details
                const callbackReason = `CALLBACK REQUEST\n` +
                    `Name: ${session.callbackName || 'Not provided'}\n` +
                    `Phone: ${session.callbackPhone || 'Not provided'}\n` +
                    `Email: ${session.callbackEmail || 'Not provided'}\n` +
                    `Preferred time: ${session.callbackTime || 'Not specified'}\n` +
                    `Products discussed: ${session.commercial.productsShown.join(', ') || 'None'}`;
                
                const emailResult = await sendEscalationEmail(
                    session.callbackEmail || session.customerEmail || 'callback-request@mint-outdoor.com',
                    session.callbackName || 'Callback requested',
                    callbackReason,
                    session.conversationHistory || [],
                    session.commercial.productsShown || []
                );
                
                let confirmationParts = [`Thank you${session.callbackName ? ', ' + session.callbackName : ''}! I've arranged your callback.`];
                confirmationParts.push(`\nOur team will call you on **${session.callbackPhone || 'the number provided'}**${session.callbackTime ? ' ' + session.callbackTime : ' as soon as possible'}.`);
                
                if (!hasPhone && hasEmail) {
                    confirmationParts = [`Thank you! I've passed your details to our team. They'll reach out to you at ${session.callbackEmail} to arrange a convenient call time.`];
                }
                
                confirmationParts.push(`\nIn the meantime, is there anything else I can help with?`);
                
                const confirmResponse = confirmationParts.join('');
                
                session.conversationHistory.push({ role: 'user', content: message });
                session.conversationHistory.push({ role: 'assistant', content: confirmResponse });
                
                await logConversationMessage(sessionId, 'user', message, { intent: 'callback_details' });
                await logConversationMessage(sessionId, 'assistant', confirmResponse, { intent: 'callback_confirmed' });
                
                return res.json({ response: confirmResponse, sessionId });
            } else {
                // Still collecting — ask for missing info
                let missingParts = [];
                if (!hasName) missingParts.push('your full name');
                if (!hasPhone) missingParts.push('your phone number');
                if (!hasEmail) missingParts.push('your email address');
                
                const promptResponse = `Thanks! I just need ${missingParts.join(' and ')} to get your callback arranged.`;
                
                session.conversationHistory.push({ role: 'user', content: message });
                session.conversationHistory.push({ role: 'assistant', content: promptResponse });
                
                return res.json({ response: promptResponse, sessionId });
            }
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
        
        console.log(`💬 Sending ${messages.length} messages to AI (${session.conversationHistory.length} history)`);
        console.log(`📋 Context: ${JSON.stringify(session.context)}`);
        
        // Call AI
        let response = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: messages,
            tools: aiTools,
            tool_choice: "auto",
            temperature: 0.4,
            max_tokens: 800
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
                    console.log(`🛡️ Whitelist: [${session.currentWhitelist.join(', ')}]`);
                    
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
                    console.log(`📧 ESCALATION REQUESTED:`, args);
                    
                    // Validate email if provided
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    
                    if (!args.customerEmail || !emailRegex.test(args.customerEmail)) {
                        // No email - ask for it first
                        console.log(`⚠️ Escalation requested but no valid email provided`);
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
                        
                        console.log(`📧 ESCALATION sent for: ${args.customerEmail}`);
                        console.log(`📧 Reason: ${args.reason}`);
                        
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
                    console.log(`📧 Email capture:`, args);
                    
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
                        
                        console.log(`📧 Quote requested for: ${args.email}`);
                        console.log(`📧 Products: ${productsForQuote.join(', ')}`);
                        
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

                if (toolCall.function.name === "get_delivery_estimate") {
                    console.log(`📦 Delivery estimate requested:`, args);
                    
                    let sku = args.productSku;
                    
                    // If no SKU provided, try to find by name
                    if (!sku && args.productName) {
                        const productResult = findProductByName(args.productName, session.commercial.productsShown);
                        if (productResult) {
                            sku = productResult.sku;
                        }
                    }
                    
                    // Also try recently shown products
                    if (!sku && session.commercial.productsShown.length > 0) {
                        sku = session.commercial.productsShown[session.commercial.productsShown.length - 1];
                    }
                    
                    if (!sku) {
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                success: false,
                                message: "I'd love to give you a delivery estimate! Which product are you interested in? If you let me know the name or range, I can check availability and delivery dates for you."
                            })
                        });
                    } else {
                        const estimate = getDeliveryEstimate(sku);
                        const stockStatus = getStockStatus(sku);
                        const product = productIndex.bySku[sku];
                        const productName = product?.product_identity?.product_name || sku;
                        
                        let deliveryInfo = {
                            sku: sku,
                            productName: productName,
                            currentStock: stockStatus
                        };
                        
                        if (stockStatus.status === 'in_stock') {
                            deliveryInfo.message = `${productName} is currently IN STOCK with ${stockStatus.quantity} units available. Standard delivery is 3-5 working days from order.`;
                            deliveryInfo.estimatedDelivery = '3-5 working days from order';
                        } else if (estimate && estimate.earliest) {
                            const estDate = estimate.earliest.estimatedDelivery;
                            const dateStr = estDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
                            deliveryInfo.message = `${productName} is available for pre-order. Estimated delivery by ${dateStr}. ${estimate.totalAvailableAcrossPos} units expected across incoming shipments.`;
                            deliveryInfo.estimatedDelivery = dateStr;
                            deliveryInfo.preOrder = true;
                            
                            // Check if customer has a required-by date
                            if (args.requiredByDate) {
                                const requiredDate = new Date(args.requiredByDate);
                                if (!isNaN(requiredDate.getTime())) {
                                    if (estDate <= requiredDate) {
                                        deliveryInfo.meetsDeadline = true;
                                        deliveryInfo.deadlineMessage = `Great news! Based on our current shipping schedule, this should arrive before your ${args.requiredByDate} deadline.`;
                                    } else {
                                        deliveryInfo.meetsDeadline = false;
                                        deliveryInfo.deadlineMessage = `Our current estimate is delivery by ${dateStr}, which may not meet your ${args.requiredByDate} deadline. I want to be upfront about that. Would you like me to check if we have similar items that could arrive sooner?`;
                                    }
                                }
                            }
                        } else {
                            deliveryInfo.message = `I don't have a confirmed delivery date for ${productName} right now. Let me connect you with our team who can give you an exact date. Could you share your email address?`;
                            deliveryInfo.needsEscalation = true;
                        }
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify(deliveryInfo)
                        });
                    }
                }

                if (toolCall.function.name === "get_order_delivery_status") {
                    console.log(`📦 Order delivery status requested:`, { orderNumber: args.orderNumber, hasPostcode: !!args.postcode });

                    const lookupOrder = (args.orderNumber || '').toString().replace(/[^0-9]/g, '');
                    const lookupPostcode = (args.postcode || '').toString().trim();

                    if (!lookupOrder || !lookupPostcode) {
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({
                                verified: false,
                                message: "To look up the order I need BOTH the order number AND the delivery postcode. Ask the customer for whichever is missing — in this reply. Do not provide any date yet."
                            })
                        });
                    } else {
                        try {
                            const controller = new AbortController();
                            const timer = setTimeout(() => controller.abort(), 5000);

                            // Step 1: deterministic verification gate (order number + postcode)
                            const vRes = await fetch(`${INTEL_API_URL}/order-intel`, {
                                method: 'POST',
                                headers: { 'X-API-Key': INTEL_API_KEY, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ orderNumber: lookupOrder, postcode: lookupPostcode }),
                                signal: controller.signal
                            });
                            const vData = vRes.ok ? await vRes.json() : null;

                            if (!vData || vData.found !== true) {
                                clearTimeout(timer);
                                toolResults.push({
                                    tool_call_id: toolCall.id,
                                    output: JSON.stringify({
                                        verified: false,
                                        message: "That order number wasn't found. Ask the customer to double-check their order number — in this reply. Do not invent any details."
                                    })
                                });
                            } else if (vData.verified !== true) {
                                clearTimeout(timer);
                                toolResults.push({
                                    tool_call_id: toolCall.id,
                                    output: JSON.stringify({
                                        verified: false,
                                        message: "The postcode does not match this order, so identity is NOT verified. Politely ask the customer to re-check the delivery postcode — in this reply. Do NOT provide any delivery date or any other order details."
                                    })
                                });
                            } else {
                                // Step 2: verified — fetch the authoritative delivery date (key on the date, not fulfilmentPath)
                                const dRes = await fetch(`${INTEL_API_URL}/delivery-promise`, {
                                    method: 'POST',
                                    headers: { 'X-API-Key': INTEL_API_KEY, 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ orderNumber: lookupOrder }),
                                    signal: controller.signal
                                });
                                clearTimeout(timer);
                                const dData = dRes.ok ? await dRes.json() : null;
                                const deliveryDate = dData && dData.authoritativeDate ? dData.authoritativeDate : null;

                                if (deliveryDate) {
                                    const overdue = dData.isOverdue === true;
                                    const message = overdue
                                        ? `The order is verified and IS running behind the original estimate. In this reply: briefly and honestly acknowledge the delay and apologise, then give the date and offer to connect them to the team. Phrase it as: "I'm sorry it's taken a little longer than planned — your order #${lookupOrder} is now on track for delivery around ${deliveryDate}. If you'd like, I can connect you with our team for more detail." Give it now; never stall.`
                                        : `The order is verified. In this reply, give the customer this delivery date now, warmly and in your own words. Suggested: "Good news — your order #${lookupOrder} is on track for delivery around ${deliveryDate}. I'll let you know here if anything changes." Do not stall and do not say you'll check.`;
                                    toolResults.push({
                                        tool_call_id: toolCall.id,
                                        output: JSON.stringify({ verified: true, deliveryDate, isOverdue: overdue, message })
                                    });
                                } else {
                                    // Verified but no confirmed date — never invent; hand off in this reply
                                    toolResults.push({
                                        tool_call_id: toolCall.id,
                                        output: JSON.stringify({
                                            verified: true,
                                            deliveryDate: null,
                                            message: "The order is verified but there is no confirmed delivery date available. Do NOT invent a date. In this reply, tell the customer you don't have a confirmed date to hand and ask them to email help@mint-outdoor.com with their order number so the team can confirm it. Never promise to get back to them yourself."
                                        })
                                    });
                                }
                            }
                        } catch (err) {
                            console.error(`[INTEL] order-delivery-status failed:`, err.message);
                            toolResults.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify({
                                    verified: false,
                                    message: "The order lookup is temporarily unavailable. In this reply, apologise briefly and ask the customer to email help@mint-outdoor.com with their order number so the team can confirm their delivery date. Do not promise to check yourself."
                                })
                            });
                        }
                    }
                }

               if (toolCall.function.name === "initiate_checkout") {
                    console.log(`🛒 Checkout initiated:`, args);
                    
                    // Try to find product by SKU first, then by name
                    let product = productIndex.bySku[args.productSku];
                    let actualSku = args.productSku;
                    
                    // If not found by SKU, try finding by name
                    if (!product && args.productSku) {
                        console.log(`🔍 Product not found by SKU, trying name lookup: "${args.productSku}"`);
                        const productResult = findProductByName(args.productSku, session.commercial.productsShown);
                        if (productResult) {
                            product = productResult.product;
                            actualSku = productResult.sku;
                            console.log(`✅ Found product by name: ${actualSku}`);
                        }
                    }
                    
                    if (!product) {
                        // Log what we tried to find for debugging
                       console.log(`❌ LOST_SALE: Could not find product: "${args.productSku}"`);
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
                                checkoutInfo.message += ` Bundle discount of 20% (saving £${discount.toFixed(2)}) applies at checkout when they add the matching cover.`;
                            }
                        }
                        
                        toolResults.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify(checkoutInfo)
                        });
                    }
                }
if (toolCall.function.name === "get_product_dimensions") {
                    console.log(`📐 Dimension query:`, args);
                    
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
                    console.log(`🎁 Accessory search:`, args);
                    
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
                            console.log(`✅ Found main product by name: ${mainSku}`);
                        }
                    }
                    
                    if (!mainProduct) {
                        console.log(`❌ Could not find main product for accessories`);
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
                        
                        console.log(`🎁 Found ${accessories.length} accessories for ${mainSku}`);
                        
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
                model: "gpt-4.1",
                messages: messages,
                response_format: { type: "json_object" },
                temperature: 0.4,
                max_tokens: 800
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
            console.log(`✅ AI intent: ${aiOutput.intent}`);
        } catch (parseError) {
            console.log(`⚠️ JSON parse failed, trying extraction...`);
            
            // LAYER 2: Try to extract JSON from markdown code blocks
            const jsonMatch = aiMessage.content?.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                try {
                    aiOutput = JSON.parse(jsonMatch[1].trim());
                    console.log(`✅ Extracted JSON from code block`);
                } catch (e2) {
                    console.log(`⚠️ Code block extraction failed`);
                }
            }
            
            // LAYER 3: Try to find JSON object in response
            if (!aiOutput) {
                const objectMatch = aiMessage.content?.match(/\{[\s\S]*\}/);
                if (objectMatch) {
                    try {
                        aiOutput = JSON.parse(objectMatch[0]);
                        console.log(`✅ Extracted JSON object from response`);
                    } catch (e3) {
                        console.log(`⚠️ Object extraction failed`);
                    }
                }
            }
            
            // ============================================
            // LAYER 4: CONTEXT-AWARE INTELLIGENT FALLBACK
            // ============================================
            if (!aiOutput) {
                console.log(`🔄 Using context-aware fallback`);
                const ctx = session.context;
                const hasWhitelist = session.currentWhitelist && session.currentWhitelist.length > 0;
                const hasContext = ctx.material || ctx.furnitureType || ctx.seatCount;
                
                // ============================================
                // PRIORITY 0: ESCALATION/SUPPORT REQUEST DETECTION
                // ============================================
                const escalationPatterns = [
                    'contact support', 'contact team', 'contact you', 'contact someone',
                    'speak to someone', 'speak to a person', 'speak to a human', 'speak to agent',
                    'speak to human', 'speak to person', 'speak to manager', 'speak to representative',
                    'talk to someone', 'talk to a person', 'talk to a human', 'talk to agent',
                    'talk to human', 'talk to person', 'talk to manager',
                    'customer service', 'customer support', 'support team', 'help desk',
                    'real person', 'real human', 'human agent', 'live agent', 'live chat',
                    'phone number', 'call you', 'call me', 'call back', 'callback',
                    'phone line', 'telephone', 'ring me',
                    'email you', 'email address', 'email me',
                    'get in touch', 'how do i contact', 'how can i contact', 'how to contact',
                    'need help', 'need assistance', 'this is useless', 'you\'re useless',
                    'not helpful', 'can\'t help', 'cannot help',
                    'want to speak', 'want to talk', 'i want a person', 'i want a human'
                ];
                
                const wantsEscalation = escalationPatterns.some(p => msgLower.includes(p));
                
                if (wantsEscalation) {
                    console.log(`🚨 ESCALATION REQUEST DETECTED in fallback`);
                    
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
                        
                        console.log(`📧 ESCALATION EMAIL SENT after email capture: ${session.customerEmail}`);
                        
                        aiOutput = {
                            intent: 'escalation_sent',
                            response_text: `Perfect, thank you! I've sent your details and our conversation to our customer service team. They will email you at ${session.customerEmail} within a few hours (or first thing tomorrow if outside business hours).\n\nIs there anything else I can help with in the meantime?`
                        };
                    }
                }
                
                // PRIORITY 1: Check if customer mentioned a SPECIFIC PRODUCT BY NAME
                // BUT FIRST - check if this is a BUNDLE/DEAL question (even if product name is mentioned)
                const bundleQuestionPatterns = [
                    'bundle', 'bundle offer', 'bundle deal', 'bundle discount', 'bundle price',
                    'any deals', 'any offers', 'any discounts', 'any savings',
                    'what deals', 'what offers', 'what discounts', 'what savings',
                    'tell me about the deal', 'tell me about the offer', 'tell me about the bundle',
                    'whats the deal', 'whats the offer', 'what is the deal', 'what is the offer',
                    'package deal', 'package price', 'money off', 'save money',
                    'buy together', 'bought together', 'combine', 'combo',
                    'get a discount', 'get a deal', 'special offer', 'special price',
                    'how much would both', 'how much for both', 'both together',
                    'set and cover', 'with the cover', 'with a cover',
                    'is there a deal', 'is there an offer', 'is there a discount'
                ];
                
                const isBundleQuestion = bundleQuestionPatterns.some(p => msgLower.includes(p));
                
                if (isBundleQuestion && session.commercial.productsShown.length > 0) {
                    console.log(`🎁 Fallback: Bundle/deal question detected - showing bundle info`);
                    session.commercial.bundleInterestShown = true;
                    
                    // Find which shown product has a bundle
                    let bundleProduct = null;
                    let bestBundle = null;
                    
                    // Check if customer mentioned a specific product family
                    const productFamiliesForBundle = ['marbella', 'stockholm', 'palma', 'faro', 'lima', 
                                                      'santorini', 'chesterton', 'kiki', 'malaga'];
                    const mentionedFamily = productFamiliesForBundle.find(f => msgLower.includes(f));
                    
                    for (const sku of session.commercial.productsShown) {
                        const bundles = getBundleForProduct(sku);
                        if (bundles.length > 0) {
                            const product = productIndex.bySku[sku];
                            const productFamily = (product?.product_identity?.product_family || sku).toLowerCase();
                            const productName = (product?.product_identity?.product_name || '').toLowerCase();
                            
                            // Prefer the bundle matching the mentioned family
                            if (mentionedFamily && (productFamily.includes(mentionedFamily) || productName.includes(mentionedFamily) || sku.toLowerCase().includes(mentionedFamily))) {
                                bundleProduct = sku;
                                bestBundle = bundles[0];
                                break;
                            }
                            // Otherwise use first product with a bundle
                            if (!bundleProduct) {
                                bundleProduct = sku;
                                bestBundle = bundles[0];
                            }
                        }
                    }
                    
                    if (bestBundle && bundleProduct) {
                        // Build bundle response with full pricing
                        let bundleTotal = 0;
                        const bundleProductNames = [];
                        
                        for (const item of bestBundle.products) {
                            const prod = productIndex.bySku[item.product_sku];
                            if (prod) {
                                const itemPrice = parseFloat(prod.product_identity?.price_gbp) || 0;
                                bundleTotal += itemPrice * item.product_qty;
                                bundleProductNames.push(prod.product_identity?.product_name || item.product_sku);
                            }
                        }
                        
                        const discountPercent = COMMERCE_RULES.bundle.discountPercent;
                        const discount = bundleTotal * (discountPercent / 100);
                        const finalPrice = bundleTotal - discount;
                        
                        // Show the bundle products and pricing
                        session.currentWhitelist = bestBundle.products.map(p => p.product_sku);
                        
                        aiOutput = {
                            intent: 'product_recommendation',
                            intro_copy: `Great news! Here's the bundle deal available:`,
                            selected_skus: session.currentWhitelist,
                            personalisation: '',
                            closing_copy: `\n\n🎁 **${bestBundle.name}**\n\n` +
                                bundleProductNames.map(n => `- ${n}`).join('\n') + `\n\n` +
                                `~~Original: £${bundleTotal.toFixed(2)}~~\n` +
                                `**Bundle Price: £${finalPrice.toFixed(2)}**\n` +
                                `*You save: £${discount.toFixed(2)} (${discountPercent}% off)*\n\n` +
                                `Want me to add this bundle to help you complete your purchase?`
                        };
                        console.log(`✅ Bundle response built: ${bestBundle.name} - save £${discount.toFixed(2)}`);
                    } else {
                        // No bundle available for shown products
                        const closingResponse = buildClosingResponse(session, sentiment);
                        aiOutput = {
                            intent: 'checkout_flow',
                            response_text: closingResponse.text
                        };
                        console.log(`⚠️ No bundle found for shown products - using closing flow`);
                    }
                }
                
                const productNamePatterns = [
                    'stockholm', 'faro', 'malaga', 'palma', 'santorini', 'barcelona',
                    'sorrento', 'valencia', 'milano', 'como', 'kiki', 'chesterton',
                    'chaise', 'lounger', 'daybed', 'bistro'
                ];
                
                const mentionedProduct = productNamePatterns.find(name => 
                    msgLower.includes(name.toLowerCase())
                );
                
                if (!aiOutput && mentionedProduct) {
                    console.log(`🔍 Fallback: Customer mentioned "${mentionedProduct}" - searching`);
                    
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
                        console.log(`✅ Fallback: Found ${productSearch.length} products`);
                    } else {
                        aiOutput = {
                            intent: 'question_answer',
                            response_text: `I couldn't find "${mentionedProduct}" in stock. Would you like me to show similar alternatives?`
                        };
                    }
                }
                
                // v16.0: PRIORITY 1.5 - PURCHASE/DISCOUNT QUESTIONS
                // Catch "how do i get the discount", "how to order", etc BEFORE generic question handler
                if (!aiOutput) {
                    const purchaseQuestionPatterns = [
                        'how do i order', 'how to order', 'how do i buy', 'how to buy',
                        'how do i get the discount', 'how to get the discount', 'how to apply discount',
                        'how does the bundle work', 'how to get 20%', 'how do i get 20',
                        'how do i purchase', 'how to purchase', 'where do i pay',
                        'how to use the discount', 'claim the discount', 'apply the discount',
                        'where do i checkout', 'how to checkout', 'payment link',
                        'can you send me a link', 'send me a link', 'order link',
                        'ready to order', 'ready to buy', 'i want to order', 'i want to buy',
                        'how do i get the bundle', 'how to get the bundle', 'how to buy the bundle',
                        'add to basket', 'add to cart', 'take my money', 'shut up and take'
                    ];
                    
                    const isPurchaseQuestion = purchaseQuestionPatterns.some(p => msgLower.includes(p));
                    
                    if (isPurchaseQuestion && session.commercial.productsShown.length > 0) {
                        console.log(`🛒 Fallback: Purchase/discount question detected - triggering closing flow`);
                        
                        // Check if this is specifically about bundles
                        const isBundleQuestion = msgLower.includes('bundle') || msgLower.includes('discount') || 
                                                  msgLower.includes('20%') || msgLower.includes('save');
                        if (isBundleQuestion) {
                            session.commercial.bundleInterestShown = true;
                        }
                        
                        const closingResponse = buildClosingResponse(session, sentiment);
                        aiOutput = {
                            intent: 'checkout_flow',
                            response_text: closingResponse.text
                        };
                    } else if (isPurchaseQuestion && session.commercial.productsShown.length === 0) {
                        console.log(`🛒 Fallback: Purchase question but no products shown yet`);
                        aiOutput = {
                            intent: 'clarification',
                            response_text: "I'd love to help you place an order! Let me first find the right product for you. What type of outdoor furniture are you looking for?"
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
                        console.log(`❓ Fallback: Detected question`);
                        
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
                            console.log(`⚖️ Fallback: Weight limit question detected`);
                            helpfulResponse = en581Info.weightLimit.response;
                            
                            // Check if they might need higher capacity
                            if (msgLower.includes('more than') || msgLower.includes('over') || 
                                msgLower.includes('higher') || msgLower.includes('bariatric')) {
                                session.escalationOffered = true;
                                session.escalationReason = 'Customer enquiring about higher weight capacity furniture';
                            }
                        } else if (isStabilityQuestion) {
                            console.log(`🪑 Fallback: Stability question detected`);
                            helpfulResponse = en581Info.customerQuestions.stability;
                        } else if (isQualityQuestion) {
                            console.log(`✅ Fallback: Quality/testing question detected`);
                            
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
                            helpfulResponse = "We offer fast UK delivery:\n\n= 3-5 working days\n= Free on orders over £500\n= Tracking sent when shipped\n\nAnything else I can help with?";
                        } else if (msgLower.includes('clean') || msgLower.includes('maintenance') || msgLower.includes('care')) {
                            helpfulResponse = "Care is easy:\n\n= **Rattan:** Wipe with damp cloth. Cover in harsh winters.\n= **Aluminium:** Just soapy water occasionally.\n= **Teak:** Oil annually or let weather to silver-grey.\n\nWould you like more tips?";
                        } else if (msgLower.includes('weather') || msgLower.includes('rain') || msgLower.includes('winter')) {
                            helpfulResponse = en581Info.customerQuestions.weatherResistance;
                        } else {
                            // Context-aware response instead of generic help menu
                            const shownProducts = session.commercial.productsShown || [];
                            if (shownProducts.length > 0) {
                                const lastSku = shownProducts[shownProducts.length - 1];
                                const lastProd = productIndex.bySku[lastSku];
                                const lastName = lastProd?.product_identity?.product_name || 'the product';
                                const bundles = getBundleForProduct(lastSku);
                                
                                if (bundles.length > 0) {
                                    helpfulResponse = `Sure! Regarding the **${lastName}**, I can help with:\n\n` +
                                        `= 🎁 **Bundle deals** - save ${COMMERCE_RULES.bundle.discountPercent}% when you buy with a matching cover\n` +
                                        `= 📐 Dimensions and specifications\n` +
                                        `= 🛡️ Warranty and durability info\n` +
                                        `= 🚚 Delivery details\n` +
                                        `= 🧹 Care and maintenance\n\n` +
                                        `What would you like to know more about?`;
                                } else {
                                    helpfulResponse = `Sure! Regarding the **${lastName}**, I can help with:\n\n` +
                                        `= 📐 Dimensions and specifications\n` +
                                        `= 🛡️ Warranty and durability info\n` +
                                        `= 🚚 Delivery details\n` +
                                        `= 🧹 Care and maintenance\n\n` +
                                        `What would you like to know more about?`;
                                }
                            } else {
                                helpfulResponse = "I'd love to help! What type of outdoor furniture are you looking for? I can show you our range of rattan, aluminium, and teak sets to find the perfect match for your garden.";
                            }
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
                        console.log(`📐 Fallback: Detected dimension query`);
                        
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
                            console.log(`📐 Using last shown product: ${lastShown}`);
                        }
                        
                        if (productFound) {
                            const includeBoxDimensions = session.context.queryType === 'box_dimensions';
                            
                            aiOutput = {
                                intent: 'dimension_query',
                                product_sku: productFound.sku,
                                include_box_dimensions: includeBoxDimensions,
                                response_text: ''
                            };
                            console.log(`✅ Fallback: Dimension query for ${productFound.sku}`);
                        } else {
                            aiOutput = {
                                intent: 'clarification',
                                response_text: "I'd be happy to help with dimensions! Which product would you like to know the size of?"
                            };
                            console.log(`❌ Fallback: Asking which product for dimensions`);
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
                        console.log(`❌ Fallback: Detected question`);
                        
                        let helpfulResponse = "";
                        
                        if (msgLower.includes('wear') || msgLower.includes('tear') || msgLower.includes('break') || msgLower.includes('damage')) {
                            helpfulResponse = "Great question! Our furniture is built to last:\n\n**Within warranty (2 years for rattan):** We repair or replace manufacturing defects free of charge.\n\n**After warranty:** Minor damage can often be repaired. We stock spare parts and replacement cushion covers.\n\n**Maximise lifespan:** Use a protective cover - extends life by 3-5 years!\n\nWould you like details on protective covers?";
                        } else if (msgLower.includes('warranty') || msgLower.includes('guarantee')) {
                            helpfulResponse = "Our warranty coverage:\n\n= **Rattan:** 2 years structural + colour\n= **Aluminium:** 10 years corrosion\n= **Teak:** 5 years structural\n= **Cushions:** 1 year\n\nAnything specific you'd like to know?";
                        } else if (msgLower.includes('delivery') || msgLower.includes('shipping')) {
                            helpfulResponse = "We offer fast UK delivery:\n\n= 3-5 working days\n= Free on orders over £500\n= Tracking sent when shipped\n\nAnything else I can help with?";
                        } else if (msgLower.includes('clean') || msgLower.includes('maintenance') || msgLower.includes('care')) {
                            helpfulResponse = "Care is easy:\n\n= **Rattan:** Wipe with damp cloth. Cover in harsh winters.\n= **Aluminium:** Just soapy water occasionally.\n= **Teak:** Oil annually or let weather to silver-grey.\n\nWould you like more tips?";
                        } else if (msgLower.includes('weather') || msgLower.includes('rain') || msgLower.includes('winter')) {
                            helpfulResponse = "Our furniture handles weather well:\n\n= **Rattan:** UV-tested 2000 hours. Cover in harsh winters.\n= **Aluminium:** 100% rust-proof, year-round outdoor use.\n= **Teak:** Naturally weather-resistant.\n\nA cover extends life significantly - shall I tell you more?";
                        } else {
                            // Context-aware response instead of generic help menu
                            const shownProducts2 = session.commercial.productsShown || [];
                            if (shownProducts2.length > 0) {
                                const lastSku2 = shownProducts2[shownProducts2.length - 1];
                                const lastProd2 = productIndex.bySku[lastSku2];
                                const lastName2 = lastProd2?.product_identity?.product_name || 'the product';
                                helpfulResponse = `Of course! What would you like to know about the **${lastName2}**? I can help with dimensions, warranty, delivery, or care tips.`;
                            } else {
                                helpfulResponse = "What would you like to know? I can help with product recommendations, warranty info, delivery details, or care and maintenance for any of our furniture ranges.";
                            }
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
                    console.log(`✅ Fallback: Showing products with context`);
                }
                
                // PRIORITY 4: Safety net
                if (!aiOutput) {
                    aiOutput = {
                        intent: 'clarification',
                        response_text: "I'd love to help! Are you looking for dining furniture, a lounge set, or perhaps a corner sofa?"
                    };
                    console.log(`✅ Fallback: Safety net`);
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
            console.log(`🚨 Escalation offered - setting flag for next response`);
            session.escalationOffered = true;
            session.escalationReason = `Customer inquiry: ${message.substring(0, 200)}`;
        }
        
        console.log(`📤 Response (${finalResponse.length} chars)`);
        console.log(`${'='.repeat(60)}\n`);
        
        res.json({
            response: finalResponse,
            sessionId: sessionId
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
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
    console.log(`\n🧪 DEBUG SEARCH: type=${type}, material=${material}, seats=${seats}`);
    
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

// ============================================
// API: BULK CONVERSATION EXPORT (JSON)
// Usage: /api/conversations/export?date=2026-03-01
//    or: /api/conversations/export?from=2026-03-01&to=2026-03-07
//    or: /api/conversations/export (defaults to today)
// ============================================
app.get('/api/conversations/export', async (req, res) => {
    if (!pool) {
        return res.status(500).json({ error: 'No database connected' });
    }
    
    try {
        // Date range handling
        let fromDate, toDate;
        
        if (req.query.date) {
            // Single date: get all conversations for that day
            fromDate = req.query.date + 'T00:00:00Z';
            toDate = req.query.date + 'T23:59:59Z';
        } else if (req.query.from && req.query.to) {
            // Date range
            fromDate = req.query.from + 'T00:00:00Z';
            toDate = req.query.to + 'T23:59:59Z';
        } else {
            // Default: today
            const today = new Date().toISOString().split('T')[0];
            fromDate = today + 'T00:00:00Z';
            toDate = today + 'T23:59:59Z';
        }
        
        console.log(`📥 Export request: ${fromDate} to ${toDate}`);
        
        // Get all unique sessions in date range
        const sessionsResult = await pool.query(`
            SELECT DISTINCT session_id,
                MIN(created_at) as started_at,
                MAX(created_at) as ended_at,
                COUNT(*) as message_count
            FROM conversation_messages
            WHERE created_at >= $1 AND created_at <= $2
            GROUP BY session_id
            ORDER BY MIN(created_at) ASC
        `, [fromDate, toDate]);
        
        // For each session, get all messages
        const conversations = [];
        
        for (const sess of sessionsResult.rows) {
            const messagesResult = await pool.query(`
                SELECT role, content, intent, products_shown,
                       sentiment, created_at
                FROM conversation_messages
                WHERE session_id = $1
                ORDER BY created_at ASC
            `, [sess.session_id]);
            
            // Extract products shown across all messages
            const allProductsShown = [];
            const intentsUsed = [];
            let lastSentiment = null;
            
            for (const msg of messagesResult.rows) {
                if (msg.products_shown) {
                    try {
                        const skus = JSON.parse(msg.products_shown);
                        if (Array.isArray(skus)) {
                            allProductsShown.push(...skus);
                        }
                    } catch(e) {}
                }
                if (msg.intent) intentsUsed.push(msg.intent);
                if (msg.sentiment) lastSentiment = msg.sentiment;
            }
            
            conversations.push({
                session_id: sess.session_id,
                started_at: sess.started_at,
                ended_at: sess.ended_at,
                message_count: parseInt(sess.message_count),
                products_shown: [...new Set(allProductsShown)],
                intents_used: [...new Set(intentsUsed)],
                final_sentiment: lastSentiment,
                messages: messagesResult.rows.map(m => ({
                    role: m.role,
                    content: m.content,
                    intent: m.intent,
                    products_shown: m.products_shown,
                    sentiment: m.sentiment,
                    timestamp: m.created_at
                }))
            });
        }
        
        const exportData = {
            export_info: {
                generated_at: new Date().toISOString(),
                from_date: fromDate,
                to_date: toDate,
                total_conversations: conversations.length,
                total_messages: conversations.reduce((sum, c) => sum + c.message_count, 0)
            },
            conversations: conversations
        };
        
        // Set headers for JSON file download
        const dateStr = fromDate.split('T')[0];
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition',
            `attachment; filename="gwen-conversations-${dateStr}.json"`);
        
        res.json(exportData);
        
    } catch (error) {
        console.error('Export error:', error.message);
        res.status(500).json({ error: error.message });
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
        { "id": "DELIVERY-002", "name": "Assembly", "input": "do you offer assembly?", "expect_any": ["assembl", "build", "set up", "service", "£69", "69.95"], "must_not_contain": ["sorry", "no"] },
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
        { "id": "PRICE-001", "name": "Price query", "input": "how much is the Faro set?", "expect_any": ["£", "price", "cost", "Faro", "from"], "must_not_contain": ["sorry", "cannot provide"] },
        { "id": "PRICE-002", "name": "Budget request", "input": "what can I get for under £1000?", "expect_any": ["£", "budget", "range", "option", "under"], "must_not_contain": ["sorry"] },
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
  
  console.log('\n🧪 =======================================');
  console.log('🧪 GWEN TEST SUITE V2');
  console.log('🧪 =======================================\n');
  
  const results = [];
  const suites = TEST_SCENARIOS_V2.suites;
  
  // Filter suites if specific ones requested
  const suitesToRun = requestedSuites 
    ? Object.keys(suites).filter(s => requestedSuites.includes(s))
    : Object.keys(suites);
  
  for (const suiteName of suitesToRun) {
    const suite = suites[suiteName];
    console.log(`\n📋 Suite: ${suiteName}`);
    
    for (const test of suite.tests) {
      console.log(`🔄 ${test.id}: ${test.name}`);
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
          model: 'gpt-4.1',
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
            model: 'gpt-4.1',
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
        
        const status = passed ? '✅ PASSED' : '❌ FAILED';
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
        console.log(`❌ ERROR: ${error.message}`);
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
  
  console.log(`\n🧪 =======================================`);
  console.log(`🧪 RESULTS: ${passed}/${total} (${passRate}%)`);
  console.log(`🧪 =======================================\n`);
  
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
  
  console.log(`\n🧪 Single test: "${input}"`);
  
  try {
    const systemPrompt = buildSystemPrompt ? buildSystemPrompt() : '';
    
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: input }
    ];
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
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
        model: "gpt-4.1",
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
    <h1>🧪 Gwen Test Results</h1>
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
        <div class="test-status ${test.passed ? 'pass' : 'fail'}">${test.passed ? '✔' : '✗'}</div>
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
    <a href="/run-tests" class="btn">🔄 Run Again</a>
    <a href="/run-tests?format=json" class="btn">📊 JSON Results</a>
    <a href="/test-single?input=I need 6 seater rattan furniture" class="btn">🧪 Test Single</a>
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
    console.log(`🚀 GWEN v14.0 - Conversation + Server Rendering`);
    console.log(`   Products: ${Object.keys(productIndex.bySku).length}`);
    console.log(`   Inventory: ${inventoryData.length} records`);
    console.log(`   OpenAI: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}`);
    console.log(`   Shopify: ${SHOPIFY_ACCESS_TOKEN ? '✅' : '⚠️'}`);
    console.log(`${'='.repeat(60)}\n`);
});

module.exports = app;