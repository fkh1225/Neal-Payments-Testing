/* global CheckoutWebComponents */

// --- DOM Element Selection ---
const quantityValue = document.getElementById("quantity-value");
const quantityMinus = document.getElementById("quantity-minus");
const quantityPlus = document.getElementById("quantity-plus");
const priceDisplay = document.getElementById("price-display");
const subtotalDisplay = document.getElementById("subtotal-display");
const discountDisplayContainer = document.getElementById(
  "discount-display-container"
);
const discountAmountDisplay = document.getElementById(
  "discount-amount-display"
);
const flowContainer = document.getElementById("flow-container");
const addressContainer = document.getElementById("address-container");
const authContainer = document.getElementById("authentication-container");
const successfulPaymentId = document.getElementById("successful-payment-id");
const refundPaymentIdInput = document.getElementById("refund-payment-id");
const refundAmountInput = document.getElementById("refund-amount");
const refundButton = document.getElementById("refund-button");
const refundErrorMessage = document.getElementById("refund-error-message");
const refundSuccessMessage = document.getElementById("refund-success-message");
const refundCurrencyLabel = document.getElementById("refund-currency-label");
const discountCodeInput = document.getElementById("discount-code");
const applyDiscountBtn = document.getElementById("apply-discount-btn");
const discountMessage = document.getElementById("discount-message");
const paymentErrorMessage = document.getElementById("error-message"); // Using the existing error span

// --- State and Constants ---
const UNIT_PRICE_DISPLAY = 90.0; // Price per item
let currentQuantity = 1;
let appliedDiscount = null; // To store discount info e.g., { code: 'SALE10', percentage: 0.10 }
const currency = "HKD";
const PUBLIC_KEY = "pk_sbox_62ssf4ywm7wxnlz7joovagwbqu3"; // Sandbox public key

// --- Checkout.com Instances ---
let checkout;
let paymentSession;

/**
 * Toggles the disabled state of the quantity adjustment buttons.
 * @param {boolean} disabled - Whether the controls should be disabled.
 */
function setQuantityControlsDisabled(disabled) {
  quantityPlus.disabled = disabled;
  // Also consider current quantity for the minus button
  quantityMinus.disabled = disabled || currentQuantity === 1;
}

/**
 * Updates the price display in the UI and calls the method to update the Flow component.
 */
async function updatePrice() {
  paymentErrorMessage.textContent = ""; // Clear previous errors
  const subtotal = UNIT_PRICE_DISPLAY * currentQuantity;
  let total = subtotal;

  subtotalDisplay.textContent = `${subtotal.toFixed(2)} ${currency}`;

  if (appliedDiscount) {
    const discountValue = subtotal * appliedDiscount.percentage;
    total = subtotal - discountValue;

    discountAmountDisplay.textContent = `- ${discountValue.toFixed(
      2
    )} ${currency}`;
    discountDisplayContainer.style.display = "block";
  } else {
    discountDisplayContainer.style.display = "none";
  }

  priceDisplay.textContent = `${total.toFixed(2)} ${currency}`;

  // If the checkout instance is ready, update the amount in the payment sheet
  if (checkout) {
    try {
      const totalInSmallestUnit = Math.round(total * 100);
      await checkout.update({ amount: totalInSmallestUnit });
    } catch (error) {
      console.error("Failed to update payment amount:", error);
    }
  }
}

/**
 * Handles the final payment submission by sending data to the server.
 * @param {object} submitData - The payment data from the Flow component.
 * @returns {Promise<object>} The server's response.
 */
const performPaymentSubmission = async (submitData) => {
  const response = await fetch("/submit-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_data: submitData,
      payment_session_id: paymentSession.id,
      quantity: currentQuantity,
      discountCode: appliedDiscount ? appliedDiscount.code : null,
    }),
  });
  return await response.json();
};

/**
 * The callback function passed to the Flow component to handle the payment submission.
 * @param {object} self - The Flow component instance.
 * @param {object} submitData - The data to be submitted for payment.
 * @returns {Promise<object>} The unmodified response from the server.
 */
const handleSubmit = async (self, submitData) => {
  paymentErrorMessage.textContent = ""; // Clear previous errors
  const submitResponse = await performPaymentSubmission(submitData);

  if (submitResponse.id) {
    // Handle success: payment ID is present
    console.log("Create Payment with PaymentId: ", submitResponse.id);
    successfulPaymentId.textContent = submitResponse.id;
    refundPaymentIdInput.value = submitResponse.id;
  } else {
    // Handle failure: No payment ID, so an error occurred.
    console.error("Payment submission failed:", submitResponse);
    // Display a user-friendly error message
    const errorText = submitResponse.error_codes
      ? submitResponse.error_codes[0].replace(/_/g, " ")
      : "Payment was declined";
    paymentErrorMessage.textContent = `Error: ${errorText}. Please try again.`;
  }

  // Return the response to the Flow component to handle any next steps (like 3DS).
  return submitResponse;
};

/**
 * Fetches an initial payment session and mounts the payment form components.
 */
async function initializePaymentSession() {
  setQuantityControlsDisabled(true);
  flowContainer.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><span>Loading...</span></div>`;
  addressContainer.innerHTML = "";
  authContainer.innerHTML = "";

  try {
    // We only need a basic session to start. The amount will be updated dynamically.
    const response = await fetch("/create-payment-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quantity: 1, // Start with a base quantity
        currency: currency,
      }),
    });

    paymentSession = await response.json();

    if (!response.ok) {
      flowContainer.innerHTML =
        '<div class="error-message">Error loading payment form. Please refresh and try again.</div>';
      throw new Error("Failed to create payment session.");
    }

    flowContainer.innerHTML = "";

    checkout = await CheckoutWebComponents({
      publicKey: PUBLIC_KEY,
      environment: "sandbox",
      locale: "en-GB",
      paymentSession,
      appearance: {
        colorAction: "#323416",
        colorFormBorder: "#8C9E6E",
        colorPrimary: "#323416",
      },
      onPaymentCompleted: (_component, paymentResponse) => {
        successfulPaymentId.textContent = paymentResponse.id;
        refundPaymentIdInput.value = paymentResponse.id;
      },
    });

    const flowComponent = checkout.create("flow", { handleSubmit });
    flowComponent.mount(flowContainer);

    const addressComponent = checkout.create("shipping_address");
    if (await addressComponent.isAvailable()) {
      addressComponent.mount(addressContainer);
    }

    const authenticationComponent = checkout.create("authentication");
    authenticationComponent.mount(authContainer);

    // After initialization, update the price to match the current state (quantity, discount)
    await updatePrice();
  } catch (error) {
    console.error("Payment session initialization failed:", error);
    if (!flowContainer.querySelector(".error-message")) {
      flowContainer.innerHTML =
        '<div class="error-message">Could not load payment options.</div>';
    }
  } finally {
    setQuantityControlsDisabled(false);
  }
}

/**
 * Sends discount code to server for validation and applies it if valid.
 */
async function applyDiscount() {
  const code = discountCodeInput.value.trim().toUpperCase();
  if (!code) {
    discountMessage.textContent = "Please enter a code.";
    discountMessage.className = "message error";
    return;
  }

  applyDiscountBtn.disabled = true;
  applyDiscountBtn.textContent = "...";
  discountMessage.textContent = "";

  try {
    const response = await fetch("/apply-discount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await response.json();

    if (data.success) {
      appliedDiscount = { code: data.code, percentage: data.percentage };
      discountMessage.textContent = `Success! ${
        data.percentage * 100
      }% discount applied.`;
      discountMessage.className = "message success";
    } else {
      appliedDiscount = null;
      discountMessage.textContent = data.message || "Invalid discount code.";
      discountMessage.className = "message error";
    }
  } catch (error) {
    console.error("Error applying discount:", error);
    discountMessage.textContent = "Could not apply discount. Please try again.";
    appliedDiscount = null;
  } finally {
    await updatePrice(); // Update price display and Flow component
    applyDiscountBtn.disabled = false;
    applyDiscountBtn.textContent = "Apply";
  }
}

/** Clears refund status messages. */
function clearRefundMessages() {
  refundErrorMessage.textContent = "";
  refundSuccessMessage.textContent = "";
}

// --- Event Listeners ---
quantityPlus.addEventListener("click", () => {
  currentQuantity++;
  quantityMinus.disabled = false;
  updatePrice();
});

quantityMinus.addEventListener("click", () => {
  if (currentQuantity > 1) {
    currentQuantity--;
    quantityMinus.disabled = currentQuantity === 1;
    updatePrice();
  }
});

applyDiscountBtn.addEventListener("click", applyDiscount);
discountCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") applyDiscount();
});

refundButton.addEventListener("click", async () => {
  clearRefundMessages();
  const paymentId = refundPaymentIdInput.value;
  const amount = parseFloat(refundAmountInput.value);

  if (!paymentId || !amount || amount <= 0) {
    refundErrorMessage.textContent =
      "Please enter a valid Payment ID and amount.";
    return;
  }

  refundButton.disabled = true;
  refundButton.textContent = "Refunding...";

  try {
    const response = await fetch("/refund-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId, amount }),
    });

    if (response.ok) {
      const successData = await response.json();
      refundSuccessMessage.textContent = `Refund successful! Action ID: ${successData.action_id}`;
      refundAmountInput.value = "";
    } else {
      const errorData = await response.json();
      const errorMessage = errorData.error_codes
        ? errorData.error_codes.join(", ")
        : "An unknown error occurred.";
      refundErrorMessage.textContent = `Refund failed: ${errorMessage}`;
    }
  } catch (error) {
    console.error("Error during refund request:", error);
    refundErrorMessage.textContent = "An unexpected network error occurred.";
  } finally {
    refundButton.disabled = false;
    refundButton.textContent = "Process Refund";
  }
});

refundPaymentIdInput.addEventListener("input", clearRefundMessages);
refundAmountInput.addEventListener("input", clearRefundMessages);

/** Initializes the page on first load. */
async function initializePage() {
  refundCurrencyLabel.textContent = `Amount to Refund ${currency}`;
  quantityMinus.disabled = currentQuantity === 1;
  await initializePaymentSession();
}

initializePage();
