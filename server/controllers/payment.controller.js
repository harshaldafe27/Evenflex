const {
    Events,
    Registrations,
    Users
} = require('../models/db');
const paymentService = require('../services/payment.service');
const {
    successResponse,
    errorResponse
} = require('../utils/apiResponse');
const {
    RAZORPAY_KEY_ID
} = require('../config/env');
const {
    generateSpecialId
} = require('../utils/generateSpecialId');

// ── helpers ──────────────────────────────────────────────────────────────────

const guardPaymentConfig = (res) => {
    if (!paymentService.isConfigured()) {
        errorResponse(res, 'Payment gateway not configured. Contact the administrator.', 503);
        return false;
    }
    return true;
};

// ── createOrder ──────────────────────────────────────────────────────────────

const createOrder = async (req, res) => {
    try {
        if (!guardPaymentConfig(res)) return;

        const {
            eventId,
            participantDetails,
            teamName,
            teamMembers
        } = req.body;

        const event = await Events.findById(eventId);
        if (!event || event.isCancelled) return errorResponse(res, 'Event not available', 404);
        if (event.fee <= 0) return errorResponse(res, 'This event is free — use the register endpoint', 400);
        if (event.registeredCount >= event.capacity) return errorResponse(res, 'Event is full', 400);

        const existing = await Registrations.findDuplicate(req.user._id, eventId);

        // Block if already confirmed/active
        if (existing && existing.status === 'confirmed') {
            return errorResponse(res, 'Already registered for this event', 409);
        }

        let registration;

        if (existing && existing.status === 'cancelled') {
            // Reuse cancelled doc
            registration = await Registrations.update(existing._id, {
                status: 'pending',
                paymentStatus: 'pending',
                amount: event.fee,
                participantDetails: participantDetails || {},
                teamName: teamName || '',
                teamMembers: teamMembers || [],
                specialId: null,
                paymentId: null,
                orderId: null,
            });
        } else if (existing && existing.status === 'pending') {
            // Reuse pending doc — update details, clear old orderId
            registration = await Registrations.update(existing._id, {
                amount: event.fee,
                participantDetails: participantDetails || {},
                teamName: teamName || '',
                teamMembers: teamMembers || [],
                orderId: null,
            });
        } else {
            // Fresh registration
            registration = await Registrations.create({
                student: req.user._id,
                event: eventId,
                status: 'pending',
                paymentStatus: 'pending',
                amount: event.fee,
                participantDetails: participantDetails || {},
                teamName: teamName || '',
                teamMembers: teamMembers || [],
            });
        }

        const receipt = ('rcpt_' + registration._id).slice(0, 40);
        const order = await paymentService.createOrder({
            amount: Math.round(event.fee * 100), // paise
            currency: 'INR',
            receipt,
            notes: {
                eventId,
                studentId: req.user._id,
                registrationId: registration._id
            },
        });

        await Registrations.update(registration._id, {
            orderId: order.id
        });

        return successResponse(res, {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            key: RAZORPAY_KEY_ID,
            registrationId: registration._id,
            eventTitle: event.title,
        }, 'Order created', 201);
    } catch (err) {
        return errorResponse(res, err.message, 500);
    }
};

// ── verifyPayment ─────────────────────────────────────────────────────────────

const verifyPayment = async (req, res) => {
    try {
        if (!guardPaymentConfig(res)) return;

        const {
            orderId,
            paymentId,
            signature,
            registrationId
        } = req.body;
        if (!orderId || !paymentId || !signature || !registrationId) {
            return errorResponse(res, 'Missing payment fields', 400);
        }

        const isValid = paymentService.verifySignature({
            orderId,
            paymentId,
            signature
        });
        if (!isValid) {
            await Registrations.update(registrationId, {
                paymentStatus: 'failed'
            });
            return errorResponse(res, 'Payment verification failed — invalid signature', 422);
        }

        const reg = await Registrations.findById(registrationId);
        if (!reg) return errorResponse(res, 'Registration not found', 404);
        if (reg.student !== req.user._id) return errorResponse(res, 'Forbidden', 403);

        // Idempotency — already confirmed
        if (reg.status === 'confirmed' && reg.paymentStatus === 'paid') {
            const event = await Events.findById(reg.event);
            return successResponse(res, {
                registration: reg,
                event
            }, 'Already confirmed');
        }

        const event = await Events.findById(reg.event);
        const specialId = generateSpecialId(event ? event.title : '');

        const updated = await Registrations.update(registrationId, {
            paymentStatus: 'paid',
            status: 'confirmed',
            paymentId,
            orderId,
            specialId,
        });

        await Events.incrementCount(reg.event, 1);

        // Non-blocking side effects
        try {
            const {
                sendRegistrationConfirmation
            } = require('../services/email.service');
            const user = await Users.findById(req.user._id);
            await sendRegistrationConfirmation(user, event);
        } catch (_) {}

        try {
            const {
                getIO
            } = require('../sockets/index');
            const io = getIO();
            if (io && event) {
                io.to('admin-' + event.createdBy).emit('registration:update', {
                    eventId: event._id,
                    count: (event.registeredCount || 0) + 1,
                });
            }
        } catch (_) {}

        return successResponse(res, {
            registration: {
                ...updated,
                specialId
            },
            event
        }, 'Payment verified');
    } catch (err) {
        return errorResponse(res, err.message, 500);
    }
};

// ── retryOrder ────────────────────────────────────────────────────────────────

const retryOrder = async (req, res) => {
    try {
        if (!guardPaymentConfig(res)) return;

        const {
            registrationId
        } = req.body;
        const reg = await Registrations.findById(registrationId);
        if (!reg) return errorResponse(res, 'Registration not found', 404);
        if (String(reg.student) !== String(req.user._id)) return errorResponse(res, 'Forbidden', 403);
        if (reg.paymentStatus === 'paid') return errorResponse(res, 'Already paid', 400);
        if (reg.status === 'cancelled') return errorResponse(res, 'Registration is cancelled', 400);

        const event = await Events.findById(reg.event);
        if (!event || event.isCancelled) return errorResponse(res, 'Event not available', 404);

        const receipt = ('rcpt_' + reg._id).slice(0, 40);
        const order = await paymentService.createOrder({
            amount: Math.round((reg.amount != null ? reg.amount : event.fee) * 100),
            currency: 'INR',
            receipt,
            notes: {
                eventId: event._id,
                studentId: req.user._id,
                registrationId: reg._id
            },
        });

        await Registrations.update(reg._id, {
            orderId: order.id
        });

        return successResponse(res, {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            key: RAZORPAY_KEY_ID,
            registrationId: reg._id,
            eventTitle: event.title,
        }, 'Retry order created', 201);
    } catch (err) {
        return errorResponse(res, err.message, 500);
    }
};

// ── getPaymentHistory ─────────────────────────────────────────────────────────

const getPaymentHistory = async (req, res) => {
    try {
        const regs = await Registrations.findByStudent(req.user._id);
        const paid = regs.filter((r) => ['paid', 'pending', 'failed'].includes(r.paymentStatus));
        const populated = await Promise.all(paid.map(async (r) => {
            const event = await Events.findById(r.event);
            return {
                ...r,
                event
            };
        }));
        return successResponse(res, {
            registrations: populated
        }, 'Payment history fetched');
    } catch (err) {
        return errorResponse(res, err.message, 500);
    }
};

module.exports = {
    createOrder,
    verifyPayment,
    getPaymentHistory,
    retryOrder
};