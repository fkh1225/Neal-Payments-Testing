require("dotenv").config();
const express = require("express");
const path = require("path");
const fetch = require("node-fetch");
const crypto = require("crypto"); // Import the crypto module for security
const app = express();

// A raw body is needed to verify the webhook signature.
// The "verify" function will be called for each request,
// and save the raw body on the request object.
const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || "utf8");
  }
};

// Use the raw body saver for all routes, but also use express.json() for parsing.
app.use(express.json({ verify: rawBodySaver }));
app.use(express.urlencoded({ extended: true, verify: rawBodySaver }));

app.use(express.static("public"));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 80;

// --- Environment Variables ---
const SECRET_KEY = process.env.SECRET_KEY;
const pcidHK = process.env.PCID_HK;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // Webhook Signature key in Dashboard

app.post("/create-payment-sessions", async (req, res) => {
  const { quantity, currency } = req.body;

  if (!quantity || quantity <= 0) {
    return res.status(400).json({ error: "Invalid quantity" });
  }

  // Calculate total amount on the server to prevent manipulation
  const unitPrice = 9000; // 90.00 in the smallest currency unit (e.g., cents)
  const totalAmount = unitPrice * quantity;

  const paymentData = {
    amount: totalAmount,
    currency: currency || "HKD",
    reference: `ORD-${Date.now()}`,
    display_name: "Online shop",
    payment_type: "Regular",
    billing: { address: { country: "HK" } },
    customer: { name: "Neal Fung", email: "neal@dummy.com" },
    items: [
      {
        reference: "0001",
        name: "New iPhone Case designed by Neal",
        quantity: quantity,
        unit_price: unitPrice,
      },
    ],
    capture: true,
    processing_channel_id: pcidHK,
    success_url: "https://example.com/payments/success",
    failure_url: "https://example.com/payments/failure",
  };

  try {
    const request = await fetch(
      "https://api.sandbox.checkout.com/payment-sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(paymentData),
      }
    );
    const parsedPayload = await request.json();
    res.status(request.status).send(parsedPayload);
  } catch (error) {
    console.error("Error creating payment session:", error);
    res.status(500).json({ error: "Could not create payment session." });
  }
});

app.post("/refund-payment", async (req, res) => {
  const { paymentId, amount } = req.body;
  if (!paymentId || !amount) {
    return res
      .status(400)
      .json({ error: "Payment ID and amount are required." });
  }

  const refundAmount = Math.round(amount * 100);

  try {
    const response = await fetch(
      `https://api.sandbox.checkout.com/payments/${paymentId}/refunds`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: refundAmount,
          reference: `REF-${Date.now()}`,
        }),
      }
    );
    const data = await response.json();
    res.status(response.status).send(data);
  } catch (error) {
    console.error("Error processing refund:", error);
    res
      .status(500)
      .json({ error: "An unexpected error occurred during the refund." });
  }
});

// --- NEW: Webhook Endpoint ---
app.post("/webhooks", (req, res) => {
  const signature = req.headers["cko-signature"];
  if (!signature) {
    console.warn("Webhook received without a CKO-Signature header.");
    return res.status(401).send("Signature not found.");
  }

  if (!WEBHOOK_SECRET) {
    console.error("Webhook secret is not configured in environment variables.");
    return res.status(500).send("Internal server configuration error.");
  }

  try {
    // Verify the signature using HMAC-SHA256
    const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
    hmac.update(req.rawBody); // Use the raw body saved by our middleware
    const calculatedSignature = hmac.digest("hex");

    if (calculatedSignature !== signature) {
      console.warn("Invalid webhook signature received.");
      return res.status(401).send("Invalid signature.");
    }

    // If the signature is valid, acknowledge receipt to Checkout.com immediately
    console.log("Webhook signature verified successfully.");
    res.status(200).send("Webhook received and acknowledged.");

    // Process the event after sending the 200 OK response
    const event = req.body;
    console.log(`Processing event: ${event.type}`);

    // Use a switch statement to handle different types of payment events
    switch (event.type) {
      case "payment_approved":
        console.log(
          `Payment approved for ID: ${event.data.id}. You can now update the order status.`
        );
        // To-do: Add business logic here (e.g., update order status in a database).
        break;
      case "payment_captured":
        console.log(
          `Payment captured for ID: ${event.data.id}. You can now fulfill the order.`
        );
        // To-do: Fulfill the order, send confirmation email, etc.
        break;
      case "payment_declined":
        console.log(
          `Payment declined for ID: ${event.data.id}. Reason: ${event.data.response_summary}`
        );
        // To-do: Notify the customer, cancel the order, etc.
        break;
      case "payment_refunded":
        console.log(`Payment refunded for ID: ${event.data.id}.`);
        // To-do: Update inventory, notify accounting, etc.
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error("Error processing webhook:", error);
    // The response has already been sent, so we just log the error for debugging.
  }
});

app.listen(PORT, () =>
  console.log(`Server is running on http://localhost:${PORT}.`)
);
