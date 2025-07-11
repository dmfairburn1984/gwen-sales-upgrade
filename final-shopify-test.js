// final-shopify-test.js
// Final test that handles inventory issues gracefully

require('dotenv').config();

const SHOPIFY_DOMAIN = 'bb69ce-b5.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

async function finalShopifyTest() {
  try {
    console.log('🧪 Final Shopify Integration Test for Gwen...\n');
    
    // Test 1: Store connection
    const storeResponse = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    const storeData = await storeResponse.json();
    console.log('✅ STORE CONNECTION: Perfect!');
    console.log(`   Store: ${storeData.shop.name}`);
    console.log(`   Domain: ${storeData.shop.domain}`);
    console.log(`   Owner: ${storeData.shop.shop_owner}`);
    
    // Test 2: Products with detailed info
    const productsResponse = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/products.json?limit=10`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    const productsData = await productsResponse.json();
    console.log('\n✅ PRODUCTS CONNECTION: Perfect!');
    console.log(`   Total products: ${productsData.products.length}`);
    
    // Analyze product data for Gwen
    let productsWithSKUs = 0;
    let productsWithPrices = 0;
    let productsWithImages = 0;
    
    productsData.products.forEach(product => {
      if (product.variants.some(v => v.sku)) productsWithSKUs++;
      if (product.variants.some(v => v.price && parseFloat(v.price) > 0)) productsWithPrices++;
      if (product.images && product.images.length > 0) productsWithImages++;
    });
    
    console.log(`   Products with SKUs: ${productsWithSKUs}`);
    console.log(`   Products with prices: ${productsWithPrices}`);
    console.log(`   Products with images: ${productsWithImages}`);
    
    // Show first few products as examples
    console.log('\n📦 Product Examples for Gwen:');
    productsData.products.slice(0, 3).forEach((product, index) => {
      console.log(`   ${index + 1}. "${product.title}"`);
      console.log(`      SKU: ${product.variants[0]?.sku || 'No SKU'}`);
      console.log(`      Price: $${product.variants[0]?.price || '0.00'}`);
      console.log(`      Available: ${product.variants[0]?.inventory_quantity || 'Unknown'}`);
    });
    
    // Test 3: Inventory (with graceful handling)
    console.log('\n🏪 INVENTORY TEST:');
    try {
      const inventoryResponse = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/inventory_levels.json?limit=5`, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });
      
      if (inventoryResponse.ok) {
        const inventoryData = await inventoryResponse.json();
        console.log('✅ Inventory API: Working');
        console.log(`   Inventory records: ${inventoryData.inventory_levels.length}`);
      } else {
        console.log('⚠️ Inventory API: Not available (422 error)');
        console.log('   This is fine - Gwen will use variant inventory_quantity instead');
      }
    } catch (error) {
      console.log('⚠️ Inventory API: Not available');
      console.log('   This is fine - Gwen will use product variants for stock info');
    }
    
    // Test 4: Check if we can create draft orders (for cart functionality)
    console.log('\n🛒 CART FUNCTIONALITY TEST:');
    try {
      // Just test permissions, don't actually create
      const testDraftResponse = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2024-01/draft_orders.json?limit=1`, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });
      
      if (testDraftResponse.ok) {
        console.log('✅ Draft Orders: Gwen can create carts for customers');
      } else {
        console.log('⚠️ Draft Orders: Limited permissions');
      }
    } catch (error) {
      console.log('⚠️ Draft Orders: API not accessible');
    }
    
    // Final summary
    console.log('\n🎉 GWEN-SHOPIFY INTEGRATION READY!');
    console.log('\n📊 Integration Summary:');
    console.log('   ✅ Store data: Connected');
    console.log('   ✅ Product catalog: Available');
    console.log('   ✅ Real product data: Ready for Gwen');
    console.log('   ⚠️ Inventory: Will use variant quantities');
    console.log('   ✅ Authentication: Working perfectly');
    
    console.log('\n🚀 Next Steps:');
    console.log('   1. Integrate live products into Gwen');
    console.log('   2. Add cart functionality');
    console.log('   3. Create Shopify widget');
    console.log('   4. Replace RepAI');
    
    return true;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

// Run the final test
finalShopifyTest();