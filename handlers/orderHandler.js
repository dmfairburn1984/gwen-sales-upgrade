// handlers/orderHandler.js - Wrapper for existing customer service system
// This interfaces with your existing index.js functionality without modifying it

const axios = require('axios');

class OrderHandler {
    constructor() {
        // If your existing system runs on a different port, we can proxy to it
        // For now, we'll integrate the core functions directly
        this.customerData = this.loadCustomerData();
        this.orderData = this.loadOrderData();
    }
    
    loadCustomerData() {
        try {
            return require('../data/Master_Customer_Order_File.json');
        } catch (error) {
            console.log('Customer data not found, using empty dataset');
            return [];
        }
    }
    
    loadOrderData() {
        try {
            return require('../data/Gwen_PO_Order_Report.json');
        } catch (error) {
            console.log('Order data not found, using empty dataset');
            return [];
        }
    }
    
    async handle(message, session) {
        // Detect if this is an order-related inquiry
        const orderKeywords = [
            'order', 'delivery', 'tracking', 'shipped', 'refund', 'return',
            'where is my', 'when will', 'cancel', 'change order', 
            'order number', 'receipt', 'invoice'
        ];
        
        const isOrderQuery = orderKeywords.some(keyword => 
            message.toLowerCase().includes(keyword)
        );
        
        if (!isOrderQuery && !session.context.orderId) {
            // Not an order query, let sales handler take over
            return {
                message: "I'd be happy to help you find the perfect outdoor furniture! What kind of space are you looking to furnish?",
                switchToSales: true
            };
        }
        
        // Handle order queries using your existing logic
        // This is a simplified version - you can integrate your full system here
        
        if (message.toLowerCase().includes('order') && /\d{6,}/.test(message)) {
            // Extract order number
            const orderMatch = message.match(/\d{6,}/);
            const orderId = orderMatch ? orderMatch[0] : null;
            
            if (orderId) {
                return await this.getOrderStatus(orderId, session);
            }
        }
        
        // Check if customer needs verification
        if (!session.context.verified) {
            return {
                message: `Hello! I'm Gwen from MINT Outdoor customer service. I'd be happy to help with your order inquiry. 

For security purposes, I'll need to verify your identity first. Please provide:
1. Your order number
2. Your surname
3. Your postcode

This helps us keep your information secure and comply with data protection requirements.`,
                context: { awaitingVerification: true }
            };
        }
        
        // Default customer service response
        return {
            message: `I'm here to help with your order inquiry. Could you please provide your order number so I can look up the details for you?

If you don't have your order number handy, I can also help you find it using your surname and postcode.`,
            context: { mode: 'order' }
        };
    }
    
    async getOrderStatus(orderId, session) {
        // Simplified order lookup - integrate with your existing order functions
        const order = this.orderData.find(o => o.order_id?.toString() === orderId);
        
        if (!order) {
            return {
                message: `I couldn't find an order with number ${orderId}. Please double-check the order number, or I can help you find it using your surname and postcode.`,
                context: { searchingOrder: true }
            };
        }
        
        // Store order in session context
        session.context.orderId = orderId;
        session.context.orderDetails = order;
        
        // Determine order type and status
        const isPreOrder = order.properties?.includes('Pre-ordered items');
        const status = this.determineOrderStatus(order);
        
        let statusMessage = `Great! I found your order ${orderId}.\n\n`;
        
        if (isPreOrder) {
            statusMessage += `📦 **Pre-Order Status**: ${status}\n\n`;
            statusMessage += `Your items are part of our MINT DesignDrop collection, which means they're made-to-order and shipped directly from our partner factories. This typically takes 6-10 weeks from factory to your door.\n\n`;
        } else {
            statusMessage += `📦 **Order Status**: ${status}\n\n`;
            statusMessage += `This order is from our MINT Essentials collection, which typically ships within 5-10 working days.\n\n`;
        }
        
        statusMessage += `Would you like me to check for any shipping updates or help you with anything else regarding this order?`;
        
        return {
            message: statusMessage,
            context: { 
                orderId,
                orderType: isPreOrder ? 'preorder' : 'instock',
                verified: true
            }
        };
    }
    
    determineOrderStatus(order) {
        // Simplified status logic - integrate with your existing status functions
        if (order.delivery_date) {
            return `Delivered on ${order.delivery_date}`;
        }
        if (order.shipped_date) {
            return `Shipped on ${order.shipped_date} - tracking information available`;
        }
        if (order.processing_date) {
            return `Being processed in our warehouse`;
        }
        return `Order confirmed and being prepared`;
    }
}

module.exports = OrderHandler;