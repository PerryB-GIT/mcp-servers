#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Stripe from 'stripe';

const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
if (!STRIPE_API_KEY) {
  console.error('Error: STRIPE_API_KEY environment variable is required');
  process.exit(1);
}
const stripe = new Stripe(STRIPE_API_KEY);

const server = new Server(
  { name: 'stripe-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'stripe_list_customers',
      description: 'List Stripe customers',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default: 10)' },
          email: { type: 'string', description: 'Filter by email' }
        }
      }
    },
    {
      name: 'stripe_get_customer',
      description: 'Get a specific customer by ID or email',
      inputSchema: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'Customer ID (cus_xxx)' },
          email: { type: 'string', description: 'Customer email (alternative to ID)' }
        }
      }
    },
    {
      name: 'stripe_create_customer',
      description: 'Create a new Stripe customer',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Customer email' },
          name: { type: 'string', description: 'Customer name' },
          description: { type: 'string', description: 'Description/notes' },
          metadata: { type: 'object', description: 'Custom metadata' }
        },
        required: ['email']
      }
    },
    {
      name: 'stripe_list_invoices',
      description: 'List invoices',
      inputSchema: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'Filter by customer ID' },
          status: { type: 'string', description: 'Filter by status: draft, open, paid, void, uncollectible' },
          limit: { type: 'number', description: 'Max results (default: 10)' }
        }
      }
    },
    {
      name: 'stripe_create_invoice',
      description: 'Create a new invoice',
      inputSchema: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'Customer ID' },
          description: { type: 'string', description: 'Invoice description' },
          daysUntilDue: { type: 'number', description: 'Days until due (default: 30)' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                amount: { type: 'number', description: 'Amount in cents' },
                quantity: { type: 'number' }
              }
            },
            description: 'Line items'
          }
        },
        required: ['customerId', 'items']
      }
    },
    {
      name: 'stripe_send_invoice',
      description: 'Finalize and send an invoice',
      inputSchema: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string', description: 'Invoice ID (in_xxx)' }
        },
        required: ['invoiceId']
      }
    },
    {
      name: 'stripe_list_payments',
      description: 'List payment intents/charges',
      inputSchema: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'Filter by customer' },
          limit: { type: 'number', description: 'Max results (default: 10)' }
        }
      }
    },
    {
      name: 'stripe_get_balance',
      description: 'Get current Stripe balance',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'stripe_create_payment_link',
      description: 'Create a payment link for a one-time amount',
      inputSchema: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Amount in cents (e.g., 5000 for $50)' },
          description: { type: 'string', description: 'Description/product name' }
        },
        required: ['amount', 'description']
      }
    },
    {
      name: 'stripe_list_payouts',
      description: 'List payouts to bank account',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default: 10)' }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'stripe_list_customers': {
        const { limit = 10, email } = args;
        const params = { limit };
        if (email) params.email = email;

        const customers = await stripe.customers.list(params);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: customers.data.length,
              customers: customers.data.map(c => ({
                id: c.id,
                email: c.email,
                name: c.name,
                created: new Date(c.created * 1000).toISOString(),
                balance: c.balance
              }))
            }, null, 2)
          }]
        };
      }

      case 'stripe_get_customer': {
        const { customerId, email } = args;
        let customer;

        if (customerId) {
          customer = await stripe.customers.retrieve(customerId);
        } else if (email) {
          const customers = await stripe.customers.list({ email, limit: 1 });
          customer = customers.data[0];
        }

        if (!customer) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Customer not found' }, null, 2) }] };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              customer: {
                id: customer.id,
                email: customer.email,
                name: customer.name,
                description: customer.description,
                created: new Date(customer.created * 1000).toISOString(),
                balance: customer.balance,
                metadata: customer.metadata
              }
            }, null, 2)
          }]
        };
      }

      case 'stripe_create_customer': {
        const { email, name, description, metadata } = args;
        const customer = await stripe.customers.create({ email, name, description, metadata });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              customer: { id: customer.id, email: customer.email, name: customer.name }
            }, null, 2)
          }]
        };
      }

      case 'stripe_list_invoices': {
        const { customerId, status, limit = 10 } = args;
        const params = { limit };
        if (customerId) params.customer = customerId;
        if (status) params.status = status;

        const invoices = await stripe.invoices.list(params);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: invoices.data.length,
              invoices: invoices.data.map(i => ({
                id: i.id,
                number: i.number,
                customer: i.customer,
                status: i.status,
                amount_due: i.amount_due / 100,
                amount_paid: i.amount_paid / 100,
                created: new Date(i.created * 1000).toISOString(),
                due_date: i.due_date ? new Date(i.due_date * 1000).toISOString() : null,
                hosted_invoice_url: i.hosted_invoice_url
              }))
            }, null, 2)
          }]
        };
      }

      case 'stripe_create_invoice': {
        const { customerId, description, daysUntilDue = 30, items } = args;

        // Create the invoice
        const invoice = await stripe.invoices.create({
          customer: customerId,
          description,
          collection_method: 'send_invoice',
          days_until_due: daysUntilDue
        });

        // Add line items
        for (const item of items) {
          await stripe.invoiceItems.create({
            customer: customerId,
            invoice: invoice.id,
            description: item.description,
            amount: item.amount,
            quantity: item.quantity || 1,
            currency: 'usd'
          });
        }

        // Retrieve updated invoice
        const updatedInvoice = await stripe.invoices.retrieve(invoice.id);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              invoice: {
                id: updatedInvoice.id,
                status: updatedInvoice.status,
                amount_due: updatedInvoice.amount_due / 100,
                description: updatedInvoice.description
              },
              message: 'Invoice created. Use stripe_send_invoice to finalize and send.'
            }, null, 2)
          }]
        };
      }

      case 'stripe_send_invoice': {
        const { invoiceId } = args;
        const invoice = await stripe.invoices.sendInvoice(invoiceId);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              invoice: {
                id: invoice.id,
                number: invoice.number,
                status: invoice.status,
                amount_due: invoice.amount_due / 100,
                hosted_invoice_url: invoice.hosted_invoice_url
              },
              message: 'Invoice sent to customer'
            }, null, 2)
          }]
        };
      }

      case 'stripe_list_payments': {
        const { customerId, limit = 10 } = args;
        const params = { limit };
        if (customerId) params.customer = customerId;

        const payments = await stripe.paymentIntents.list(params);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: payments.data.length,
              payments: payments.data.map(p => ({
                id: p.id,
                amount: p.amount / 100,
                status: p.status,
                customer: p.customer,
                description: p.description,
                created: new Date(p.created * 1000).toISOString()
              }))
            }, null, 2)
          }]
        };
      }

      case 'stripe_get_balance': {
        const balance = await stripe.balance.retrieve();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              available: balance.available.map(b => ({ amount: b.amount / 100, currency: b.currency })),
              pending: balance.pending.map(b => ({ amount: b.amount / 100, currency: b.currency }))
            }, null, 2)
          }]
        };
      }

      case 'stripe_create_payment_link': {
        const { amount, description } = args;

        // Create a price for the one-time payment
        const price = await stripe.prices.create({
          unit_amount: amount,
          currency: 'usd',
          product_data: { name: description }
        });

        // Create payment link
        const paymentLink = await stripe.paymentLinks.create({
          line_items: [{ price: price.id, quantity: 1 }]
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              paymentLink: {
                id: paymentLink.id,
                url: paymentLink.url,
                amount: amount / 100,
                description
              }
            }, null, 2)
          }]
        };
      }

      case 'stripe_list_payouts': {
        const { limit = 10 } = args;
        const payouts = await stripe.payouts.list({ limit });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: payouts.data.length,
              payouts: payouts.data.map(p => ({
                id: p.id,
                amount: p.amount / 100,
                status: p.status,
                arrival_date: new Date(p.arrival_date * 1000).toISOString(),
                created: new Date(p.created * 1000).toISOString()
              }))
            }, null, 2)
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: error.message }, null, 2) }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Stripe MCP server running on stdio');
}

main().catch(console.error);
