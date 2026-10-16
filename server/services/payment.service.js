const crypto = require('crypto');
const Razorpay = require('razorpay');
const {
    RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET
} = require('../config/env');

const isConfigured = () =>
    RAZORPAY_KEY_ID &&
    RAZORPAY_KEY_SECRET &&
    RAZORPAY_KEY_ID !== 'your_razorpay_key_id' &&
    RAZORPAY_KEY_SECRET !== 'your_razorpay_key_secret';

let _razorpay;
const getRazorpay = () => {
    if (!isConfigured()) {
        throw new Error('Payment gateway not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server/.env');
    }
    if (!_razorpay) {
        _razorpay = new Razorpay({
            key_id: RAZORPAY_KEY_ID,
            key_secret: RAZORPAY_KEY_SECRET
        });
    }
    return _razorpay;
};

const createOrder = async ({
    amount,
    currency,
    receipt,
    notes
}) => {
    currency = currency || 'INR';
    notes = notes || {};
    const razorpay = getRazorpay();
    try {
        return await razorpay.orders.create({
            amount,
            currency,
            receipt,
            notes
        });
    } catch (err) {
        const msg = (err && err.error && err.error.description) || (err && err.message) || 'Razorpay order creation failed';
        throw new Error(msg);
    }
};

const verifySignature = ({
    orderId,
    paymentId,
    signature
}) => {
    if (!isConfigured()) return false;
    const body = orderId + '|' + paymentId;
    const expected = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');
    return expected === signature;
};

const fetchOrder = async (orderId) => {
    return getRazorpay().orders.fetch(orderId);
};

const fetchPayment = async (paymentId) => {
    return getRazorpay().payments.fetch(paymentId);
};

module.exports = {
    createOrder,
    verifySignature,
    fetchOrder,
    fetchPayment,
    isConfigured
};