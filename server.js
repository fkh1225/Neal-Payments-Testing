require("dotenv").config();
const express = require("express");
const path = require("path");
const fetch = require("node-fetch");
const crypto = require("crypto");
const app = express();

const rawBodySaver = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || "utf8");
  }
};

app.use(express.json({ verify: rawBodySaver }));
app.use(express.urlencoded({ extended: true, verify: rawBodySaver }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 80;

const SECRET_KEY = process.env.SECRET_KEY;
const PCID_HK = process.env.PCID_HK;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET_NGORK;

// --- Product & Discount Configuration (Single Source of Truth) ---

const PRODUCT_CONFIG = {
  UNIT_PRICE: 9000, // Price in smallest currency unit (e.g., 90.00 HKD -> 9000)
};

// --- Mock Discount Codes --------
const DISCOUNTS = {
  SALE10: { percentage: 0.1 },
  SAVE20: { percentage: 0.2 },
  "50OFF": { percentage: 0.5 },
};

// --- Endpoint to validate discount codes ---
app.post("/apply-discount", (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res
      .status(400)
      .json({ success: false, message: "Discount code is required." });
  }
  const discount = DISCOUNTS[code.toUpperCase()];
  if (discount) {
    res.json({
      success: true,
      code: code.toUpperCase(),
      percentage: discount.percentage,
    });
  } else {
    res
      .status(404)
      .json({ success: false, message: "Invalid or expired discount code." });
  }
});

// --- Endpoint to create the initial payment session ---
app.post("/create-payment-sessions", async (req, res) => {
  const { quantity, currency } = req.body;

  if (!quantity || quantity <= 0) {
    return res.status(400).json({ error: "Invalid quantity" });
  }

  // Use the single source of truth for the price
  const totalAmount = PRODUCT_CONFIG.UNIT_PRICE * quantity;

  const paymentData = {
    amount: totalAmount,
    currency: currency || "HKD",
    reference: `ORD-${Date.now()}`,
    "3ds": { enabled: true },
    billing: { address: { country: "HK" } },
    customer: {
      name: "Neal Fung",
      email: "neal@dummy.com",
    },
    processing_channel_id: PCID_HK,
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

// --- Endpoint to submit the payment after client-side changes ---
app.post("/submit-payment", async (req, res) => {
  /*-------------  Breaking down session_data and payment_session_id etc.,----------------
The codes below does not work for session_data, b/c there is a duplicate session_data object in req.body.
  //  const { session_data, payment_session_id } = req.body;
  e.g. session_data:{
    session_data: "string"
  }
    Therefore use this: 
    // const { session_data } = req.body.session_data;
*/

  const { session_data } = req.body.session_data;
  const { payment_session_id, quantity, discountCode } = req.body;

  // console.log(session_data);

  /*-------------  Breaking down session_data and payment_session_id etc.,----------------*/

  if (!session_data || !payment_session_id) {
    return res.status(400).json({ error: "Session data and ID are required." });
  }

  ////////////neal

  // --- Server-side Price Calculation using the single source of truth ---
  let finalAmount = PRODUCT_CONFIG.UNIT_PRICE * quantity;

  if (discountCode) {
    const discount = DISCOUNTS[discountCode.toUpperCase()];
    if (discount) {
      const discountValue = finalAmount * discount.percentage;
      finalAmount -= discountValue;
    }
  }
  /////////////neal

  const payload = {
    amount: Math.round(finalAmount), // Use the dynamically calculated amount
    session_data: session_data,
    "3ds": { enabled: false },
  };

  console.log(`Submitting payment for session ${payment_session_id}...`);

  try {
    const response = await fetch(
      `https://api.sandbox.checkout.com/payment-sessions/${payment_session_id}/submit`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();

    // Log the response from Checkout.com for debugging
    console.log("Checkout.com API Response:", JSON.stringify(data, null, 2));

    res.status(response.status).send(data);
  } catch (error) {
    console.error("Error submitting payment:", error);
    res.status(500).json({
      error: "An unexpected error occurred during payment submission.",
    });
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

app.post("/webhooks", (req, res) => {
  const signature = req.headers["cko-signature"];
  if (!signature) {
    return res.status(401).send("Signature not found.");
  }
  if (!WEBHOOK_SECRET) {
    return res.status(500).send("Internal server configuration error.");
  }
  try {
    const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
    hmac.update(req.rawBody);
    const calculatedSignature = hmac.digest("hex");
    if (calculatedSignature !== signature) {
      return res.status(401).send("Invalid signature.");
    }
    res.status(200).send("Webhook received and acknowledged.");
    const event = req.body;
    console.log(`Processing event: ${event.type}`);
  } catch (error) {
    console.error("Error processing webhook:", error);
  }
});

app.listen(PORT, () =>
  console.log(`Server is running on http://localhost:${PORT}.`)
);
